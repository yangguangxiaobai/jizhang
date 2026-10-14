#!/usr/bin/env python3
"""Explicitly enrolled host snapshots only. Default command is read-only preview."""
import argparse
from contextlib import contextmanager, closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import subprocess
import tempfile

import archive

ROOT = Path('/opt/jizhang-backups/retention')
STATE = Path('/opt/jizhang-production/retention-state')
LOCK = Path('/opt/jizhang-production/maintenance.lock')
POLICY = {'version': 1, 'days': [7, 30, 180], 'minimum_distinct': 3,
          'plan_seconds': 900, 'scope': str(ROOT)}
NAME = re.compile(r'jizhang-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})\.db\Z')
TOKEN = re.compile(r'[A-Za-z0-9_.-]{1,100}\Z')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def utc(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None and stamp.utcoffset() == timedelta(0), 'utc-required')
    return stamp.astimezone(timezone.utc)


def now():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def safe_path(path):
    """Reject lexical aliases and every symlink component, including ancestors."""
    require(path.is_absolute() and path.resolve() == path, 'noncanonical-path')
    for part in (path, *path.parents):
        require(not part.is_symlink(), 'symlink-path')


def private(path, directory=False):
    safe_path(path)
    s = path.stat()
    require(s.st_uid == 0 and stat.S_IMODE(s.st_mode) == (0o700 if directory else 0o600)
            and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)), 'private-mode-required')
    # Parents must not permit an unprivileged user to replace the protected object.
    for parent in path.parents:
        p = parent.stat()
        require(p.st_uid == 0 and not p.st_mode & 0o022, 'unsafe-parent')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate-json-key')
        result[key] = value
    return result


def invalid_constant(value):
    raise RuntimeError('nonfinite-json-value')


def load(path):
    private(path)
    with path.open(encoding='utf-8') as stream:
        return json.load(stream, object_pairs_hook=unique_object, parse_constant=invalid_constant)


def save(path, value):
    private(path.parent, directory=True)
    if path.exists() or path.is_symlink():
        private(path)
    fd, name = tempfile.mkstemp(prefix='.retention-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        # Persist the rename, not only the new file bytes.
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextmanager
def locked():
    import fcntl  # Linux-only operations fail closed on other hosts.
    private(LOCK)
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(os.fstat(fd).st_ino == LOCK.stat().st_ino, 'lock-replaced')
        yield fd
    finally:
        os.close(fd)


def lock_guard(fd):
    import fcntl
    s = os.fstat(fd)
    private(LOCK)
    require((s.st_dev, s.st_ino) == (LOCK.stat().st_dev, LOCK.stat().st_ino), 'lock-replaced')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def created(path):
    m = NAME.fullmatch(path.name)
    require(m is not None, 'snapshot-name-required')
    day, hour, minute, second, millis = m.groups()
    return utc(f'{day}T{hour}:{minute}:{second}.{millis}+00:00').isoformat()


def fingerprint(path):
    safe_path(path)
    require(ROOT in path.parents and path.parent == ROOT, 'outside-managed-root')
    private(ROOT, directory=True)
    private(path)
    s = path.stat()
    require(s.st_nlink == 1 and s.st_size > 0, 'not-independent-regular-file')
    require(not any(Path(str(path) + suffix).exists() or Path(str(path) + suffix).is_symlink()
                    for suffix in ('-wal', '-shm', '-journal')), 'sidecar-present')
    with path.open('rb') as stream:
        hasher = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
        sha = hasher.hexdigest()
    end = path.stat()
    identity = lambda st: [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns]
    require(identity(s) == identity(end), 'snapshot-changed')
    return {'sha256': sha, 'stat': identity(s), 'bytes': s.st_size}


def verify(path):
    """Integrity plus isolated restore/read check; never open the live database."""
    before = fingerprint(path)
    # immutable=1 prevents SQLite from touching a source's journal/sidecar files.
    with tempfile.TemporaryDirectory(prefix='jizhang-verify-') as temp:
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as source:
            require(source.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'integrity-failed')
            with closing(sqlite3.connect(str(Path(temp) / 'restore.db'))) as target:
                source.backup(target)
                require(target.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'restore-failed')
                tables = {r[0] for r in target.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                require({'users', 'transactions', 'schema_migrations'} <= tables, 'application-tables-missing')
    require(fingerprint(path) == before, 'snapshot-changed')
    return before


def registry():
    r = load(STATE / 'registry.json')
    require(set(r) == {'version', 'policy', 'entries'} and r['version'] == 1
            and r['policy'] == POLICY and isinstance(r['entries'], list), 'registry-invalid')
    paths = set()
    for e in r['entries']:
        require(set(e) == {'path', 'created', 'fingerprint', 'verified', 'offserver', 'pin', 'release'}, 'entry-invalid')
        p = Path(e['path'])
        require(p.parent == ROOT and p.name not in paths and created(p) == e['created'], 'entry-path-invalid')
        paths.add(p.name)
        require(e['verified'] == 'isolated-sqlite-restore-v1', 'verification-evidence-invalid')
        require(isinstance(e['pin'], bool) and isinstance(e['release'], str)
                and (not e['release'] or TOKEN.fullmatch(e['release'])), 'protection-invalid')
        f = e['fingerprint']
        require(set(f) == {'sha256', 'stat', 'bytes'} and re.fullmatch('[0-9a-f]{64}', f['sha256'])
                and isinstance(f['stat'], list) and len(f['stat']) == 5
                and all(type(x) is int for x in f['stat']) and type(f['bytes']) is int
                and f['bytes'] > 0, 'fingerprint-invalid')
        o = e['offserver']
        require(o is None or (set(o) == {'sha256', 'checked_at', 'receipt_id'}
                and o['sha256'] == f['sha256'] and TOKEN.fullmatch(o['receipt_id'])
                and utc(o['checked_at']) >= utc(e['created'])), 'offserver-invalid')
    return r


def select(entries, clock):
    """Select distinct hashes first; preserve every copy of a retained point."""
    groups = {}
    for e in entries:
        groups.setdefault(e['fingerprint']['sha256'], []).append(e)
    ordered = sorted(groups, key=lambda h: (max(utc(e['created']) for e in groups[h]), h), reverse=True)
    reasons = {h: [] for h in ordered}
    buckets = set()
    for index, h in enumerate(ordered):
        date = max(utc(e['created']) for e in groups[h])
        age = (clock - date).total_seconds() / 86400
        if index < 3:
            reasons[h].append('latest-three-distinct')
        if any(e['pin'] for e in groups[h]):
            reasons[h].append('pinned')
        if any(e['release'] for e in groups[h]):
            reasons[h].append('release-associated')
        if age < 0:
            reasons[h].append('future-time-blocked')
        elif age < 7:
            reasons[h].append('recent-seven-days')
        elif age < 180:
            bucket = ('week', *date.isocalendar()[:2]) if age < 30 else ('month', date.year, date.month)
            if bucket not in buckets:
                reasons[h].append('utc-' + bucket[0])
                buckets.add(bucket)
    return reasons


def reference_guard(containers, path):
    for c in containers:
        for ref, kind in archive.references(c):
            if archive.inside(str(path), Path(ref)) or archive.inside(ref, path):
                return True
    return False


def preview(r, clock, containers):
    private(ROOT, directory=True)
    valid, blocked = [], []
    for e in r['entries']:
        try:
            require(utc(e['created']) <= clock, 'future-time')
            require(verify(Path(e['path'])) == e['fingerprint'], 'identity-drift')
            require(not reference_guard(containers, Path(e['path'])), 'container-reference')
            valid.append(e)
        except (RuntimeError, OSError, sqlite3.Error, ValueError):
            blocked.append({'path': e['path'], 'status': 'blocked', 'reasons': ['verification-path-or-reference-failed'], 'bytes': 0})
    reasons = select(valid, clock)
    enough = len(reasons) >= 3
    retained = [e for e in valid if reasons[e['fingerprint']['sha256']]]
    # Operator attests successful independent off-host verification, bound to hash.
    offserver = all(e['offserver'] is not None and utc(e['offserver']['checked_at']) <= clock for e in retained)
    rows = list(blocked)
    for e in valid:
        why = reasons[e['fingerprint']['sha256']]
        if not why and (not enough or not offserver or blocked):
            why = ['apply-blocked-insufficient-points-offserver-or-invalid-entry']
        rows.append({'path': e['path'], 'status': 'retained' if why else 'candidate',
                     'reasons': why or ['outside-retention-tiers'], 'bytes': e['fingerprint']['bytes']})
    enrolled = {e['path'] for e in r['entries']}
    for p in sorted(ROOT.iterdir()):
        if str(p) not in enrolled:
            rows.append({'path': str(p), 'status': 'unmanaged-pinned', 'reasons': ['not-enrolled-never-delete'], 'bytes': 0})
    rows.sort(key=lambda row: row['path'])
    return {'version': 1, 'at': clock.isoformat(), 'registry_digest': digest(r), 'policy_digest': digest(POLICY),
            'rows': rows, 'candidate_bytes': sum(e['bytes'] for e in rows if e['status'] == 'candidate'),
            'distinct_verified': len(reasons), 'apply_ready': enough and offserver and not blocked,
            'newest_verified_at': max((e['created'] for e in valid), default=None),
            'scope': 'enrolled-host-only; legacy/app/volume/local/source/image/config excluded'}


def production_guard(containers):
    # Reuse topology checks without the archive tool's obsolete fixed image tag.
    apps = [c for c in containers if c.get('Name') == '/jizhang']
    require(len(apps) == 1, 'api-missing')
    app = apps[0]
    labels = app['Config'].get('Labels') or {}
    require(app['State'].get('Running') is True and app['State'].get('Health', {}).get('Status') == 'healthy', 'api-unhealthy')
    require(labels.get('com.docker.compose.project') == 'jizhang'
            and labels.get('com.docker.compose.service') == 'jizhang'
            and labels.get('com.docker.compose.project.working_dir') == str(archive.PRODUCTION)
            and labels.get('com.docker.compose.project.config_files', '').split(',')
            == [str(archive.PRODUCTION / f) for f in archive.FILES], 'topology-drift')
    data = [m for m in app['Mounts'] if m.get('Destination') == '/data']
    require(len(data) == 1 and data[0].get('Type') == 'volume' and data[0].get('Name') == archive.VOLUME, 'volume-drift')
    for name in (*archive.FILES, '.env'):
        p = archive.PRODUCTION / name
        safe_path(p)
        require(p.is_file(), 'config-missing')


def audit(event, plan_id, path=None):
    target = STATE / 'audit.jsonl'
    if target.exists() or target.is_symlink():
        private(target)
    fd = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a', encoding='utf-8') as stream:
        stream.write(json.dumps({'at': now().isoformat(), 'event': event, 'plan': plan_id, 'path': path}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def apply(plan, approved, clock, lock_fd):
    require(approved == digest(plan), 'approval-digest-mismatch')
    age = (clock - utc(plan['at'])).total_seconds()
    require(0 <= age <= POLICY['plan_seconds'], 'plan-expired')
    r = registry()
    containers = archive.snapshot()
    production_guard(containers)
    # Freeze tier time at preview; wall clock is only used for bounded expiry.
    fresh = preview(r, utc(plan['at']), containers)
    require(fresh == plan and fresh['apply_ready'], 'plan-drift-or-blocked')
    lock_guard(lock_fd)
    audit('begin', approved)
    try:
        for row in plan['rows']:
            if row['status'] != 'candidate':
                continue
            lock_guard(lock_fd)
            require((now() - utc(plan['at'])).total_seconds() <= POLICY['plan_seconds'], 'plan-expired')
            require(registry() == r, 'registry-drift')
            containers = archive.snapshot()
            production_guard(containers)
            # Verify all remaining points again before each unlink, not just candidate.
            remaining_plan = preview(r, utc(plan['at']), containers)
            require(remaining_plan['apply_ready'], 'remaining-recovery-unsafe')
            current = next(x for x in remaining_plan['rows'] if x['path'] == row['path'])
            require(current == row, 'candidate-drift')
            path = Path(row['path'])
            e = next(e for e in r['entries'] if e['path'] == row['path'])
            require(verify(path) == e['fingerprint'], 'candidate-drift')
            audit('unlink-intent', approved, str(path))
            path.unlink()  # exactly one enrolled DB file; never rmtree or Docker prune
            audit('unlinked', approved, str(path))
            r['entries'].remove(e)
            save(STATE / 'registry.json', r)
        audit('complete', approved)
    except Exception:
        audit('stopped-partial-review-required', approved)
        raise


def enroll(r, path, pin, release, receipt):
    require(not release or TOKEN.fullmatch(release), 'release-id-invalid')
    require(str(path) not in {e['path'] for e in r['entries']}, 'already-enrolled')
    stamp = created(path)
    require(utc(stamp) <= now(), 'future-time')
    f = verify(path)
    offserver = load(receipt) if receipt else None
    if offserver is not None:
        require(set(offserver) == {'sha256', 'checked_at', 'receipt_id'}
                and offserver['sha256'] == f['sha256'] and TOKEN.fullmatch(offserver['receipt_id'])
                and utc(stamp) <= utc(offserver['checked_at']) <= now(), 'receipt-invalid')
    r['entries'].append({'path': str(path), 'created': stamp, 'fingerprint': f,
                         'verified': 'isolated-sqlite-restore-v1', 'offserver': offserver,
                         'pin': pin, 'release': release})
    save(STATE / 'registry.json', r)


def attest(r, path, receipt):
    e = next((e for e in r['entries'] if e['path'] == str(path)), None)
    require(e is not None and verify(path) == e['fingerprint'], 'attestation-target-invalid')
    evidence = load(receipt)
    require(set(evidence) == {'sha256', 'checked_at', 'receipt_id'}
            and evidence['sha256'] == e['fingerprint']['sha256']
            and TOKEN.fullmatch(evidence['receipt_id'])
            and utc(e['created']) <= utc(evidence['checked_at']) <= now(), 'receipt-invalid')
    e['offserver'] = evidence
    save(STATE / 'registry.json', r)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command')
    sub.add_parser('init')
    en = sub.add_parser('enroll')
    en.add_argument('path', type=Path)
    en.add_argument('--pin', action='store_true')
    en.add_argument('--release', default='')
    en.add_argument('--offserver-receipt', type=Path)
    at = sub.add_parser('attest')
    at.add_argument('path', type=Path)
    at.add_argument('--offserver-receipt', type=Path, required=True)
    pv = sub.add_parser('preview')
    pv.add_argument('--save-plan', type=Path)
    ap = sub.add_parser('apply')
    ap.add_argument('--plan', type=Path, required=True)
    ap.add_argument('--approved-plan-sha256', required=True)
    args = parser.parse_args()
    require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'linux-root-required')
    private(STATE, directory=True)
    private(ROOT, directory=True)
    with locked() as fd:
        if args.command == 'init':
            require(not (STATE / 'registry.json').exists(), 'already-initialized')
            save(STATE / 'registry.json', {'version': 1, 'policy': POLICY, 'entries': []})
        elif args.command == 'enroll':
            enroll(registry(), args.path, args.pin, args.release, args.offserver_receipt)
        elif args.command == 'attest':
            attest(registry(), args.path, args.offserver_receipt)
        elif args.command == 'apply':
            apply(load(args.plan), args.approved_plan_sha256, now(), fd)
        else:
            plan = preview(registry(), now(), archive.snapshot())
            if args.command == 'preview' and args.save_plan:
                require(args.save_plan.parent == STATE and args.save_plan.name != 'registry.json'
                        and args.save_plan.name.endswith('.plan.json'), 'plan-location-invalid')
                save(args.save_plan, plan)
            print(json.dumps({'mode': 'dry-run', 'plan_sha256': digest(plan), 'plan': plan}, indent=2))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, sqlite3.Error, ImportError, subprocess.SubprocessError):
        print('Retention refused/stopped. No further deletion; review private audit for partial progress.', file=sys.stderr)
        sys.exit(1)
