"""Regression checks for safe manual-upload archives (Python stdlib only)."""

import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("bundle", Path(__file__).with_name("create-source-bundle.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleSafetyTests(unittest.TestCase):
    def test_secret_and_generated_files_are_not_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in bundle.ROOT_FILES | bundle.PACKAGE_FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("public example", encoding="utf-8")
            for name in ("packages/server/src/app.ts", "packages/shared/src/index.ts"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("export {};", encoding="utf-8")
            secrets = (
                ".env", ".env.production", "data/jizhang.db", "clients/android/key.jks",
                "packages/web/src/main.ts", "packages/server/src/.env",
                "packages/server/src/node_modules/generated.ts", "packages/server/src/private.pem",
                "packages/server/dist/index.ts",
            )
            for name in secrets:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("must-never-ship", encoding="utf-8")
            archive = root / "artifacts/source.tar.gz"
            bundle.create_bundle(root, archive, False)
            with tarfile.open(archive, "r:gz") as packaged:
                self.assertTrue(all("must-never-ship" not in packaged.extractfile(member).read().decode() for member in packaged.getmembers()))
                self.assertIn(f"{bundle.PREFIX}/.env.example", packaged.getnames())
            self.assertEqual(bundle.verify_archive(archive), len(bundle.ROOT_FILES | bundle.PACKAGE_FILES) + 2)

    def test_verifier_rejects_path_traversal_links_and_unexpected_env(self):
        for name, kind in (
            (f"{bundle.PREFIX}/../../.env", tarfile.REGTYPE),
            (f"{bundle.PREFIX}/.env", tarfile.REGTYPE),
            (f"{bundle.PREFIX}/packages/server/src/app.ts", tarfile.SYMTYPE),
        ):
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / "unsafe.tar.gz"
                with tarfile.open(archive, "w:gz") as packaged:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    info.size = 1 if kind == tarfile.REGTYPE else 0
                    info.linkname = "../../.env" if kind == tarfile.SYMTYPE else ""
                    packaged.addfile(info, io.BytesIO(b"x") if info.size else None)
                with self.assertRaises(ValueError):
                    bundle.verify_archive(archive)


if __name__ == "__main__":
    unittest.main()
