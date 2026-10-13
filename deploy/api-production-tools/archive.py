#!/usr/bin/env python3
"""Archive a fixed legacy allowlist, never delete or operate containers."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

PRODUCTION = Path('/opt/jizhang-production')
VOLUME = 'jizhang_jizhang-data'
IMAGE = 'jizhang:api-2026-10-12'
FILES = ('docker-compose.yml', 'docker-compose.migration.yml',
         'runtime.override.yml', 'image.override.yml')
CANDIDATES = tuple(Path(p) for p in (
    '/opt/jizhang', '/opt/jizhang-api-2026-10-09', '/opt/jizhang-upload-old',
    '/home/ubuntu/jizhang-64be4b1-source.tar.gz',
    '/home/ubuntu/jizhang-images-64be4b1',
    '/home/ubuntu/jizhang-release-64be4b1'))
ARCHIVE = Path('/opt/jizhang-archive')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True,
                            timeout=60, check=False)
    require(result.returncode == 0, 'Docker query failed; nothing may be moved')
    return result.stdout


def snapshot():
    ids = docker('ps', '-aq', '--no-trunc').split()
    require(len(ids) == len(set(ids)), 'Duplicate container IDs')
    containers = []
    for cid in ids:
        rows = json.loads(docker('inspect', cid))
        require(isinstance(rows, list) and len(rows) == 1 and rows[0]['Id'] == cid,
                'Incomplete container inspection')
        c = rows[0]
        require(isinstance(c['Mounts'], list) and isinstance(c['Config'], dict)
                and (c['Config'].get('Labels') is None or isinstance(c['Config']['Labels'], dict)),
                'Invalid container inspection')
        containers.append(c)
    require(set(docker('ps', '-aq', '--no-trunc').split()) == set(ids),
            'Container inventory changed; retry during a maintenance window')
    return containers


def inside(path, base):
    # Check both lexical and resolved paths (symlink aliases must also block).
    p = Path(path)
    require(p.is_absolute(), 'Relative Docker reference; cannot prove archive safety')
    return p == base or base in p.parents or p.resolve() == base.resolve() or base.resolve() in p.resolve().parents


def references(container):
    labels = container['Config'].get('Labels') or {}
    for m in container['Mounts']:
        require(isinstance(m.get('Source'), str) and bool(m['Source']),
                'Missing mount Source')
        yield m['Source'], 'mount'
    work = labels.get('com.docker.compose.project.working_dir')
    if work:
        yield work, 'compose working_dir'
    configs = labels.get('com.docker.compose.project.config_files')
    if configs:
        for path in configs.split(','):
            require(bool(path.strip()), 'Malformed Compose config_files')
            yield path.strip(), 'compose config_files'


def plan(containers):
    result = []
    for candidate in CANDIDATES:
        reasons = []
        for c in containers:
            for path, kind in references(c):
                if inside(path, candidate) or (kind == 'mount' and inside(str(candidate), Path(path))):
                    # IDs only: no arbitrary labels or environment values in output.
                    reasons.append({'container': c['Id'], 'reference': kind})
        status = 'blocked' if reasons else 'eligible'
        if not candidate.exists() and not candidate.is_symlink():
            status = 'missing'
        elif candidate.is_symlink() or candidate.resolve() != candidate:
            status = 'blocked'
            reasons.append({'reference': 'symlink path'})
        elif candidate.is_mount():
            status = 'blocked'
            reasons.append({'reference': 'filesystem mount point'})
        result.append({'path': str(candidate), 'status': status, 'reasons': reasons})
    return result


def production_guard(containers):
    apps = [c for c in containers if c.get('Name') == '/jizhang']
    require(len(apps) == 1, 'Expected exactly one production API container')
    c = apps[0]
    labels = c['Config'].get('Labels') or {}
    require(c['State'].get('Running') is True
            and c['State'].get('Health', {}).get('Status') == 'healthy',
            'Production API must be running and healthy')
    require(c['Config'].get('Image') == IMAGE, 'Production API image tag changed')
    images = json.loads(docker('image', 'inspect', IMAGE))
    require(len(images) == 1 and images[0]['Id'] == c['Image'], 'Running image ID differs from expected tag')
    data = [m for m in c['Mounts'] if m.get('Destination') == '/data']
    require(len(data) == 1 and data[0].get('Type') == 'volume'
            and data[0].get('Name') == VOLUME, 'Production data volume changed')
    volumes = json.loads(docker('volume', 'inspect', VOLUME))
    require(len(volumes) == 1 and volumes[0]['Name'] == VOLUME, 'Data volume inspection failed')
    require(labels.get('com.docker.compose.project') == 'jizhang'
            and labels.get('com.docker.compose.service') == 'jizhang'
            and labels.get('com.docker.compose.project.working_dir') == str(PRODUCTION),
            'Production Compose labels changed')
    paths = [s.strip() for s in labels.get('com.docker.compose.project.config_files', '').split(',')]
    require(paths == [str(PRODUCTION / f) for f in FILES], 'Production config_files must reference all four production files in order')
    require(PRODUCTION.resolve() == PRODUCTION, 'Production path is symlinked')
    for f in (*FILES, '.env'):
        path = PRODUCTION / f
        require(path.is_file() and not path.is_symlink(), 'Missing or symlinked production configuration')


def private_directory(path):
    require(not path.is_symlink() and path.resolve() == path, 'Archive path is symlinked')
    path.mkdir(mode=0o700, exist_ok=True)
    st = path.stat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0
            and stat.S_IMODE(st.st_mode) == 0o700, 'Archive directory must be root-owned mode 700')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='opt in to moving eligible legacy paths')
    args = parser.parse_args()
    containers = snapshot()
    entries = plan(containers)
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', 'candidates': entries}, indent=2))
    if not args.apply:
        return
    require(os.geteuid() == 0, '--apply requires root')
    production_guard(containers)
    private_directory(ARCHIVE)
    destination = ARCHIVE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + str(os.getpid()))
    destination.mkdir(mode=0o700)
    # Sanitized journal only. Full inspect/config JSON is intentionally never saved.
    journal = destination / 'manifest.json'
    record = {'candidates': entries, 'moved': []}
    def save():
        with journal.open('w', encoding='utf-8') as stream:
            json.dump(record, stream, indent=2)
        journal.chmod(0o600)
    save()
    for entry in entries:
        if entry['status'] != 'eligible':
            continue
        fresh = snapshot()
        production_guard(fresh)
        current = next(e for e in plan(fresh) if e['path'] == entry['path'])
        require(current['status'] == 'eligible', 'Candidate safety changed; archive stopped')
        source = Path(entry['path'])
        target = destination / source.name
        require(not target.exists(), 'Archive destination already exists')
        require(source.stat().st_dev == destination.stat().st_dev,
                'Cross-filesystem move refused; no copy/delete fallback')
        # rename only: preserves bytes, ownership and modes; never deletes contents.
        source.rename(target)
        record['moved'].append({'from': str(source), 'to': str(target)})
        save()
        print('Archived allowlisted path: ' + str(source))
    print('Archive journal: ' + str(journal))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Docker errors/JSON may contain secrets: never echo their payloads.
        print('Archive refused or stopped; no cleanup performed. Check topology, Docker access, permissions and private journal if created.', file=sys.stderr)
        sys.exit(1)
