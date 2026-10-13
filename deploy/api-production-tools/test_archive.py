"""Local fixtures only; no Docker daemon or production filesystem access."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('archive_tools', Path(__file__).with_name('archive.py'))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


def app():
    return {'Id': 'a' * 64, 'Name': '/jizhang', 'Image': 'sha256:expected',
            'Mounts': [{'Source': '/var/lib/docker/volumes/jizhang_jizhang-data/_data',
                        'Destination': '/data', 'Type': 'volume', 'Name': archive.VOLUME}],
            'Config': {'Image': archive.IMAGE, 'Labels': {
                'com.docker.compose.project': 'jizhang',
                'com.docker.compose.service': 'jizhang',
                'com.docker.compose.project.working_dir': str(archive.PRODUCTION),
                'com.docker.compose.project.config_files': ','.join(str(archive.PRODUCTION / f) for f in archive.FILES)}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}}}


class ArchiveTests(unittest.TestCase):
    def test_stopped_worker_compose_reference_blocks_old_directory(self):
        c = {'Id': 'worker', 'Mounts': [], 'State': {'Running': False},
             'Config': {'Labels': {'com.docker.compose.project.config_files': '/opt/jizhang/docker-compose.yml'}}}
        with patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_mount', return_value=False), \
                patch.object(Path, 'is_absolute', return_value=True), patch.object(Path, 'resolve', lambda self: self):
            self.assertEqual(archive.plan([c])[0]['status'], 'blocked')

    def test_mount_blocks_candidate_but_not_similarly_named_directory(self):
        c = {'Id': 'stopped', 'Mounts': [{'Source': '/opt/jizhang-upload-old/subdir'}], 'Config': {'Labels': {}}}
        with patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_mount', return_value=False), \
                patch.object(Path, 'is_absolute', return_value=True), patch.object(Path, 'resolve', lambda self: self):
            entries = archive.plan([c])
            self.assertEqual(entries[0]['status'], 'eligible')
            self.assertEqual(entries[2]['status'], 'blocked')
        with patch.object(Path, 'is_absolute', return_value=True), patch.object(Path, 'resolve', lambda self: self):
            self.assertFalse(archive.inside('/opt/jizhang-other', Path('/opt/jizhang')))

    def test_parent_mount_blocks_candidate(self):
        c = {'Id': 'parent-mount', 'Mounts': [{'Source': '/opt'}], 'Config': {'Labels': {}}}
        with patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_mount', return_value=False),                 patch.object(Path, 'is_absolute', return_value=True), patch.object(Path, 'resolve', lambda self: self):
            self.assertEqual(archive.plan([c])[0]['status'], 'blocked')

    def test_malformed_empty_labels_is_closed(self):
        import json
        c = app()
        c['Config']['Labels'] = []
        with patch.object(archive, 'docker', side_effect=[c['Id'], json.dumps([c])]):
            with self.assertRaises(RuntimeError):
                archive.snapshot()

    def test_inspect_failure_is_closed(self):
        with patch.object(archive, 'docker', side_effect=['abc\n', RuntimeError('fail')]):
            with self.assertRaises(RuntimeError):
                archive.snapshot()

    def test_inventory_race_is_closed(self):
        import json
        c = app()
        with patch.object(archive, 'docker', side_effect=[c['Id'], json.dumps([c]), 'different']):
            with self.assertRaises(RuntimeError):
                archive.snapshot()

    def test_production_guard_rejects_unhealthy_wrong_image_volume_labels(self):
        for mutation in ('health', 'image', 'volume', 'labels'):
            c = app()
            if mutation == 'health':
                c['State']['Health']['Status'] = 'unhealthy'
            elif mutation == 'image':
                c['Config']['Image'] = 'other'
            elif mutation == 'volume':
                c['Mounts'][0]['Name'] = 'empty-new-volume'
            else:
                c['Config']['Labels']['com.docker.compose.project.config_files'] = '/opt/jizhang/docker-compose.yml'
            with patch.object(archive, 'docker', side_effect=['[{"Id":"sha256:expected"}]', '[{"Name":"jizhang_jizhang-data"}]']):
                with self.assertRaises(RuntimeError, msg=mutation):
                    archive.production_guard([c])

    def test_relative_reference_is_not_assumed_safe(self):
        with self.assertRaises(RuntimeError):
            archive.inside('relative/docker-compose.yml', Path('/opt/jizhang'))

    def test_default_dry_run_never_creates_or_renames(self):
        with patch('sys.argv', ['archive.py']), patch.object(archive, 'snapshot', return_value=[]), \
                patch.object(archive, 'plan', return_value=[]), patch.object(Path, 'mkdir') as mkdir, \
                patch.object(Path, 'rename') as rename, patch('builtins.print'):
            archive.main()
            mkdir.assert_not_called()
            rename.assert_not_called()


if __name__ == '__main__':
    unittest.main()
