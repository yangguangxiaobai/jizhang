"""Temporary DB fixtures and mocked host guards; never access production."""
from contextlib import closing
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import retention as tool

CLOCK = datetime(2026, 10, 14, 12, tzinfo=timezone.utc)


def point(days, key=None, pin=False, release=''):
    date = CLOCK - timedelta(days=days)
    key = key or str(days)
    sha = hashlib.sha256(key.encode()).hexdigest()
    return {'path': f'/fixture/{key}.db', 'created': date.isoformat(), 'pin': pin,
            'release': release, 'fingerprint': {'sha256': sha, 'stat': [1, 2, 3, 4, 5], 'bytes': 3},
            'verified': 'isolated-sqlite-restore-v1',
            'offserver': {'sha256': sha, 'checked_at': CLOCK.isoformat(), 'receipt_id': 'receipt'}}


class SelectorTests(unittest.TestCase):
    def test_disjoint_boundaries(self):
        entries = [point(d) for d in (0, 1, 2, 6.999, 7, 7.001, 29.999, 30, 30.001, 179.999, 180, 181)]
        r = tool.select(entries, CLOCK)
        why = lambda d: r[point(d)['fingerprint']['sha256']]
        self.assertIn('recent-seven-days', why(6.999))
        self.assertIn('utc-week', why(7))
        self.assertNotIn('recent-seven-days', why(7))
        self.assertIn('utc-week', why(29.999))
        self.assertIn('utc-month', why(30))
        self.assertIn('utc-month', why(179.999))
        self.assertEqual(why(180), [])
        self.assertEqual(why(181), [])

    def test_copies_do_not_satisfy_minimum_three(self):
        entries = [point(200, 'same'), point(201, 'same'), point(202, 'same')]
        self.assertEqual(len(tool.select(entries, CLOCK)), 1)

    def test_all_copies_pins_and_release_associations_retained(self):
        entries = [point(0), point(1), point(2), point(200, 'dup'), point(201, 'dup', pin=True), point(300, release='old-release')]
        r = tool.select(entries, CLOCK)
        self.assertIn('pinned', r[point(200, 'dup')['fingerprint']['sha256']])
        self.assertIn('release-associated', r[point(300)['fingerprint']['sha256']])

    def test_iso_week_year_and_utc_month(self):
        clock = datetime(2027, 1, 15, tzinfo=timezone.utc)
        entries = [point(d) for d in (0, 1, 2)]
        for i, e in enumerate(entries):
            e['created'] = (clock - timedelta(days=i)).isoformat()
        for day in ('2027-01-01', '2026-12-31', '2026-12-15', '2026-12-14', '2026-11-30'):
            e = point(200, day)
            e['created'] = day + 'T00:00:00+00:00'
            entries.append(e)
        r = tool.select(entries, clock)
        self.assertIn('utc-week', r[entries[3]['fingerprint']['sha256']])
        self.assertEqual(r[entries[4]['fingerprint']['sha256']], [])  # same ISO year/week
        self.assertIn('utc-month', r[entries[5]['fingerprint']['sha256']])
        self.assertEqual(r[entries[6]['fingerprint']['sha256']], [])
        self.assertIn('utc-month', r[entries[7]['fingerprint']['sha256']])

    def test_offset_and_naive_dates_rejected(self):
        for date in ('2026-10-14', '2026-10-14T12:00:00+08:00'):
            with self.assertRaises(RuntimeError):
                tool.utc(date)

    def test_future_kept_and_latest_three_even_when_ancient(self):
        entries = [point(d) for d in (-1, 200, 201, 202)]
        r = tool.select(entries, CLOCK)
        self.assertIn('future-time-blocked', r[entries[0]['fingerprint']['sha256']])
        self.assertIn('latest-three-distinct', r[entries[2]['fingerprint']['sha256']])
        self.assertEqual(r[entries[3]['fingerprint']['sha256']], [])


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.patchers = [patch.object(tool, 'ROOT', self.root), patch.object(tool, 'private'),
                         patch.object(tool, 'now', return_value=CLOCK)]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self.patchers):
            p.stop()
        self.temp.cleanup()

    def db(self, days):
        date = CLOCK - timedelta(days=days)
        p = self.root / date.strftime('jizhang-%Y-%m-%dT%H-%M-%S-000.db')
        with closing(sqlite3.connect(p)) as db:
            for table in ('users', 'transactions', 'schema_migrations'):
                db.execute(f'CREATE TABLE {table} (value INTEGER)')
            db.execute('INSERT INTO transactions VALUES (?)', (int(days),))
            db.commit()
        f = tool.verify(p)
        return {'path': str(p), 'created': tool.created(p), 'pin': False, 'release': '',
                'verified': 'isolated-sqlite-restore-v1', 'fingerprint': f,
                'offserver': {'sha256': f['sha256'], 'checked_at': CLOCK.isoformat(), 'receipt_id': 'fixture'}}

    def reg(self):
        return {'version': 1, 'policy': tool.POLICY, 'entries': [self.db(d) for d in (0, 1, 2, 200, 201)]}

    def test_real_restore_is_read_only(self):
        e = self.db(0)
        p = Path(e['path'])
        before = p.read_bytes()
        self.assertEqual(tool.verify(p), e['fingerprint'])
        self.assertEqual(p.read_bytes(), before)
        self.assertEqual(list(self.root.iterdir()), [p])

    def test_corrupt_wrong_application_and_sidecar_rejected(self):
        e = self.db(0)
        p = Path(e['path'])
        side = Path(str(p) + '-wal')
        side.touch()
        with self.assertRaises(RuntimeError):
            tool.verify(p)
        side.unlink()
        p.write_bytes(b'not-a-database')
        with self.assertRaises(sqlite3.Error):
            tool.verify(p)
        p.unlink()
        with closing(sqlite3.connect(p)) as db:
            db.execute('CREATE TABLE unknown (id INTEGER)')
        with self.assertRaises(RuntimeError):
            tool.verify(p)

    def test_symlink_or_hardlink_rejected(self):
        e = self.db(0)
        target = self.root / 'copy.db'
        try:
            target.symlink_to(e['path'])
        except OSError:
            pass  # Windows may forbid symlink creation; hardlink still exercised.
        else:
            with self.assertRaises(RuntimeError):
                tool.fingerprint(target)
            target.unlink()
        os.link(e['path'], target)
        with self.assertRaises(RuntimeError):
            tool.fingerprint(Path(e['path']))

    def test_preview_is_deterministic_and_unknown_never_candidate(self):
        r = self.reg()
        unknown = self.root / 'failed.db'
        unknown.write_bytes(b'partial')
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        plan = tool.preview(r, CLOCK, [])
        self.assertEqual(plan, tool.preview(r, CLOCK, []))
        self.assertTrue(plan['apply_ready'])
        self.assertEqual(sum(x['status'] == 'candidate' for x in plan['rows']), 2)
        self.assertEqual(next(x for x in plan['rows'] if x['path'] == str(unknown))['status'], 'unmanaged-pinned')
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})

    def test_missing_offserver_or_invalid_new_point_blocks_all_deletion(self):
        base = self.reg()
        for mode in ('receipt', 'corrupt', 'future'):
            with self.subTest(mode=mode):
                r = copy.deepcopy(base)
                if mode == 'receipt':
                    r['entries'][0]['offserver'] = None
                elif mode == 'corrupt':
                    r['entries'][0]['fingerprint']['sha256'] = '0' * 64
                else:
                    r['entries'][0]['created'] = (CLOCK + timedelta(days=1)).isoformat()
                plan = tool.preview(r, CLOCK, [])
                self.assertFalse(plan['apply_ready'])
                self.assertFalse(any(x['status'] == 'candidate' for x in plan['rows']))

    def test_insufficient_distinct_points_keeps_all(self):
        r = self.reg()
        r['entries'] = r['entries'][:2]
        plan = tool.preview(r, CLOCK, [])
        self.assertFalse(plan['apply_ready'])
        self.assertFalse(any(x['status'] == 'candidate' for x in plan['rows']))

    def test_stopped_container_parent_mount_blocks_enrolled_file(self):
        r = self.reg()
        c = {'Mounts': [{'Source': str(self.root)}], 'Config': {'Labels': {}}, 'State': {'Running': False}}
        plan = tool.preview(r, CLOCK, [c])
        self.assertFalse(plan['apply_ready'])
        self.assertTrue(all(x['status'] == 'blocked' for x in plan['rows']))

    def test_enrollment_and_later_attestation_workflow(self):
        e = self.db(0)
        r = {'version': 1, 'policy': tool.POLICY, 'entries': []}
        with patch.object(tool, 'save') as save:
            tool.enroll(r, Path(e['path']), True, 'release-1', None)
            self.assertTrue(r['entries'][0]['pin'])
            self.assertIsNone(r['entries'][0]['offserver'])
            with patch.object(tool, 'load', return_value=e['offserver']):
                tool.attest(r, Path(e['path']), self.root / 'receipt.json')
            self.assertEqual(r['entries'][0]['offserver'], e['offserver'])
            self.assertEqual(save.call_count, 2)
            with self.assertRaises(RuntimeError):
                tool.enroll(r, Path(e['path']), False, '', None)

    def test_registry_schema_rejects_policy_and_path_drift(self):
        r = self.reg()
        with patch.object(tool, 'load', return_value=r):
            self.assertEqual(tool.registry(), r)
            r['policy'] = {}
            with self.assertRaises(RuntimeError):
                tool.registry()
            r['policy'] = tool.POLICY
            r['entries'][0]['path'] = '/data/jizhang.db'
            with self.assertRaises(RuntimeError):
                tool.registry()

    def test_duplicate_json_keys_and_nonfinite_values_rejected(self):
        path = self.root / 'registry.json'
        for content in ('{"entries": [], "entries": []}',
                        '{"nested": {"pin": true, "pin": false}}',
                        '{"value": NaN}', '{"value": Infinity}'):
            path.write_text(content, encoding='utf-8')
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                tool.load(path)

    def test_receipt_hash_future_time_and_missing_evidence_rejected(self):
        e = self.db(0)
        for change in ({'sha256': '0' * 64},
                       {'checked_at': (CLOCK + timedelta(seconds=1)).isoformat()},
                       {'checked_at': (CLOCK - timedelta(days=1)).isoformat()},
                       {'receipt_id': 'arbitrary/private/path'}):
            r = {'version': 1, 'policy': tool.POLICY, 'entries': [copy.deepcopy(e)]}
            evidence = dict(e['offserver'], **change)
            with patch.object(tool, 'load', return_value=evidence), patch.object(tool, 'save') as save:
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    tool.attest(r, Path(e['path']), self.root / 'receipt.json')
                save.assert_not_called()

    def apply_context(self, r):
        return [patch.object(tool, 'registry', side_effect=lambda: copy.deepcopy(r)),
                patch.object(tool.archive, 'snapshot', return_value=[]),
                patch.object(tool, 'production_guard'), patch.object(tool, 'lock_guard'),
                patch.object(tool, 'audit'), patch.object(tool, 'save', side_effect=lambda p, v: r.update(copy.deepcopy(v)))]

    def test_apply_revalidates_and_only_unlinks_reviewed_candidates(self):
        r = self.reg()
        plan = tool.preview(r, CLOCK, [])
        patches = self.apply_context(r)
        for item in patches:
            item.start()
        try:
            tool.apply(plan, tool.digest(plan), CLOCK, 99)
            self.assertEqual(len(list(self.root.iterdir())), 3)
            self.assertEqual(len(r['entries']), 3)
            self.assertEqual(tool.audit.call_args.args[0], 'complete')
        finally:
            for item in reversed(patches):
                item.stop()

    def test_drift_expiry_approval_and_lock_conflict_fail_closed(self):
        r = self.reg()
        plan = tool.preview(r, CLOCK, [])
        patches = self.apply_context(r)
        for item in patches:
            item.start()
        try:
            with self.assertRaises(RuntimeError):
                tool.apply(plan, 'not-approved', CLOCK, 99)
            with self.assertRaises(RuntimeError):
                tool.apply(plan, tool.digest(plan), CLOCK + timedelta(seconds=901), 99)
            tool.lock_guard.side_effect = RuntimeError('lock-conflict')
            with self.assertRaises(RuntimeError):
                tool.apply(plan, tool.digest(plan), CLOCK, 99)
            tool.lock_guard.side_effect = None
            Path(r['entries'][-1]['path']).write_bytes(b'changed')
            with self.assertRaises(RuntimeError):
                tool.apply(plan, tool.digest(plan), CLOCK, 99)
            self.assertEqual(len(list(self.root.iterdir())), 5)
        finally:
            for item in reversed(patches):
                item.stop()

    def test_audit_failure_before_unlink_never_deletes(self):
        r = self.reg()
        plan = tool.preview(r, CLOCK, [])
        patches = self.apply_context(r)
        for item in patches:
            item.start()
        try:
            def fail_intent(event, *args):
                if event == 'unlink-intent':
                    raise OSError('fixture-audit-failure')
            tool.audit.side_effect = fail_intent
            with self.assertRaises(OSError):
                tool.apply(plan, tool.digest(plan), CLOCK, 99)
            self.assertEqual(len(list(self.root.iterdir())), 5)
            tool.save.assert_not_called()
        finally:
            for item in reversed(patches):
                item.stop()

    def test_retained_point_drift_during_apply_stops_before_unlink(self):
        r = self.reg()
        plan = tool.preview(r, CLOCK, [])
        patches = self.apply_context(r)
        for item in patches:
            item.start()
        try:
            def drift(event, *args):
                if event == 'begin':
                    Path(r['entries'][0]['path']).write_bytes(b'fixture-corruption')
            tool.audit.side_effect = drift
            with self.assertRaises(RuntimeError):
                tool.apply(plan, tool.digest(plan), CLOCK, 99)
            self.assertEqual(len(list(self.root.iterdir())), 5)
            tool.save.assert_not_called()
        finally:
            for item in reversed(patches):
                item.stop()

    def test_partial_unlink_error_stops_and_journals(self):
        r = self.reg()
        plan = tool.preview(r, CLOCK, [])
        patches = self.apply_context(r)
        for item in patches:
            item.start()
        original = Path.unlink
        calls = []
        def fail_second(path, *args, **kwargs):
            if path.parent == self.root:
                calls.append(path)
                if len(calls) == 2:
                    raise OSError('fixture-error')
            return original(path, *args, **kwargs)
        try:
            with patch.object(Path, 'unlink', fail_second), self.assertRaises(OSError):
                tool.apply(plan, tool.digest(plan), CLOCK, 99)
            self.assertEqual(len(list(self.root.iterdir())), 4)
            self.assertEqual(len(r['entries']), 4)
            self.assertEqual(tool.audit.call_args.args[0], 'stopped-partial-review-required')
        finally:
            for item in reversed(patches):
                item.stop()


class LinuxLockTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'linux', 'Real flock/protected permissions require Linux')
    def test_private_rejects_world_writable_ancestor(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp).resolve() / 'receipt.json'
            path.touch(mode=0o600)
            with self.assertRaises(RuntimeError):
                tool.private(path)  # /tmp is writable; fixtures cannot be production state.

    @unittest.skipUnless(sys.platform == 'linux', 'Real wrapper/flock requires Linux')
    def test_wrapper_operations_and_shared_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            production = root / 'production'
            production.mkdir()
            for name in (*tool.archive.FILES, '.env'):
                (production / name).touch()
            lock = production / 'maintenance.lock'
            lock.touch(mode=0o600)
            commands = root / 'commands.jsonl'
            docker = root / 'docker'
            docker.write_text('#!/usr/bin/env python3\nimport json, os, sys\n'
                              'with open(os.environ["COMMANDS"], "a") as f:\n'
                              ' f.write(json.dumps({"args": sys.argv[1:], "volume": os.environ.get("JIZHANG_DATA_VOLUME")}) + "\\n")\n')
            docker.chmod(0o700)
            # Only fixture copies are relocated, never installed production files.
            wrapper = root / 'manage.sh'
            source = Path(__file__).with_name('manage.sh').read_text()
            wrapper.write_text(source.replace('/opt/jizhang-production', str(production)))
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], COMMANDS=str(commands))
            base = ['compose', '-p', 'jizhang', '--env-file', str(production / '.env')]
            for name in tool.archive.FILES:
                base += ['-f', name]
            expected = {'status': ['ps', '-a'], 'config': ['config', '--quiet'],
                        'logs': ['logs', '--tail', '100', 'jizhang'],
                        'up': ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'jizhang'],
                        'backup': ['exec', '-T', 'jizhang', 'node', 'packages/server/dist/cli.js',
                                   'backup', '/data/backups/production-handoff', '0']}
            for operation, suffix in expected.items():
                result = subprocess.run(['bash', str(wrapper), operation], env=env, capture_output=True)
                # up/backup's real ownership check requires root; other operations do not.
                if operation in ('up', 'backup') and os.geteuid() != 0:
                    self.assertNotEqual(result.returncode, 0)
                    continue
                self.assertEqual(result.returncode, 0, result.stderr)
                record = json.loads(commands.read_text().splitlines()[-1])
                self.assertEqual(record, {'args': base + suffix, 'volume': tool.archive.VOLUME})
            before = commands.read_bytes()
            with patch.object(tool, 'LOCK', lock), patch.object(tool, 'private'), tool.locked():
                for operation in ('up', 'backup'):
                    result = subprocess.run(['bash', str(wrapper), operation], env=env, capture_output=True)
                    self.assertNotEqual(result.returncode, 0)
            for args in (['down'], ['up', 'extra'], []):
                result = subprocess.run(['bash', str(wrapper), *args], env=env, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            self.assertEqual(commands.read_bytes(), before)
            lock.unlink()
            self.assertEqual(subprocess.run(['bash', str(wrapper), 'status'], env=env, capture_output=True).returncode, 0)
            self.assertNotEqual(subprocess.run(['bash', str(wrapper), 'backup'], env=env, capture_output=True).returncode, 0)

    @unittest.skipUnless(sys.platform == 'linux', 'Real flock/protected permissions require Linux')
    def test_real_lock_conflict_and_inode_replacement(self):
        with tempfile.TemporaryDirectory() as temp:
            lock = Path(temp) / 'lock'
            lock.touch(mode=0o600)
            with patch.object(tool, 'LOCK', lock), patch.object(tool, 'private'):
                with tool.locked() as fd:
                    with self.assertRaises(BlockingIOError):
                        with tool.locked():
                            pass
                    lock.unlink()
                    lock.touch(mode=0o600)
                    with self.assertRaises(RuntimeError):
                        tool.lock_guard(fd)


if __name__ == '__main__':
    unittest.main()
