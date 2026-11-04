"""Create/verify an API-only manual-upload source archive using Python stdlib.

Run from any directory. No .env, data, keys, Web, native or generated output is
selected. An exact allowlist, regular-file restriction and per-file digests are
checked after creation. This does not build or verify a Docker image.
"""

from __future__ import annotations

import argparse
from datetime import date
import gzip
import hashlib
import io
from pathlib import Path, PurePosixPath
import tarfile


PREFIX = "jizhang-api-source"
ROOT_FILES = frozenset(
    {
        "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
        ".npmrc", ".dockerignore", ".env.example", "Dockerfile", "docker-compose.yml",
        "docker-compose.migration.yml", "docker-compose.bind.yml", "docker-compose.caddy.yml",
        "DEPLOY.md", "README.md",
    }
)
PACKAGE_FILES = frozenset(
    {
        "packages/server/package.json", "packages/server/tsconfig.json",
        "packages/shared/package.json", "packages/shared/tsconfig.json",
        "packages/server/scripts/check-api-only.mjs",
        "packages/server/scripts/lib/retired-web.mjs",
        "deploy/Caddyfile.host.example", "deploy/Caddyfile.container.example",
        "deploy/db-manifest.mjs", "deploy/create-source-bundle.py",
    }
)
CUTOUT_FILES = frozenset(
    {
        "packages/cutout/Dockerfile", "packages/cutout/requirements.txt",
        "packages/cutout/requirements-test.txt", "packages/cutout/THIRD_PARTY_NOTICES.md",
    }
)
BLOCKED_PARTS = frozenset(
    {
        "node_modules", "dist", "build", "data", "backups", "coverage", "__pycache__",
        ".venv", ".pytest_cache", ".git", ".trellis", "clients", "web",
    }
)


def allowed(relative: str, include_cutout: bool) -> bool:
    """Allow known configuration or plain source files, never arbitrary trees."""
    if relative in ROOT_FILES or relative in PACKAGE_FILES:
        return True
    parts = PurePosixPath(relative).parts
    if not parts or any(part in BLOCKED_PARTS or part.startswith(".") for part in parts):
        return False
    if relative.startswith(("packages/server/src/", "packages/shared/src/")):
        return relative.endswith(".ts")
    if include_cutout:
        if relative in CUTOUT_FILES:
            return True
        if relative.startswith(("packages/cutout/app/", "packages/cutout/tests/")):
            return relative.endswith(".py")
    return False


def collect_files(root: Path, include_cutout: bool) -> list[tuple[str, Path]]:
    required = ROOT_FILES | PACKAGE_FILES | (CUTOUT_FILES if include_cutout else frozenset())
    selected = set(required)
    directories = ["packages/server/src", "packages/shared/src"]
    if include_cutout:
        directories += ["packages/cutout/app", "packages/cutout/tests"]
    for directory in directories:
        source = root / directory
        if not source.is_dir() or source.is_symlink():
            raise ValueError(f"Missing or linked source directory: {directory}")
        for path in source.rglob("*"):
            relative = path.relative_to(root).as_posix()
            if path.is_file() and allowed(relative, include_cutout):
                selected.add(relative)
    result = []
    for relative in sorted(selected):
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or linked required file: {relative}")
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Source escapes repository: {relative}")
        # Reject linked parent directories even when they resolve inside root.
        if any(parent.is_symlink() for parent in path.parents if parent.is_relative_to(root)):
            raise ValueError(f"Linked parent directory: {relative}")
        result.append((relative, path))
    return result


def add_file(archive: tarfile.TarFile, relative: str, content: bytes) -> None:
    info = tarfile.TarInfo(f"{PREFIX}/{relative}")
    info.size = len(content)
    info.mtime = 0
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(content))


def verify_archive(path: Path, expected: set[str] | None = None) -> int:
    """Verify without extraction; reject unexpected paths, links and digests."""
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(set(names)) != len(names):
            raise ValueError("Duplicate archive members")
        checksums = {}
        contents = {}
        include_cutout = any(name.startswith(f"{PREFIX}/packages/cutout/") for name in names)
        for member in members:
            pure = PurePosixPath(member.name)
            if not member.isfile() or pure.is_absolute() or ".." in pure.parts:
                raise ValueError(f"Unsafe archive member: {member.name}")
            if not member.name.startswith(f"{PREFIX}/"):
                raise ValueError(f"Unexpected archive prefix: {member.name}")
            relative = member.name[len(PREFIX) + 1:]
            if relative != "SHA256SUMS" and not allowed(relative, include_cutout):
                raise ValueError(f"Non-allowlisted archive member: {relative}")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"Unreadable archive member: {relative}")
            if relative == "SHA256SUMS":
                for line in stream.read().decode("utf-8").splitlines():
                    digest, separator, name = line.partition("  ")
                    if not separator or len(digest) != 64 or name in checksums:
                        raise ValueError("Invalid checksum manifest")
                    checksums[name] = digest
            else:
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                contents[relative] = digest.hexdigest()
        if checksums != contents:
            raise ValueError("Missing, changed or unexpected checksum entries")
        required = ROOT_FILES | PACKAGE_FILES | (CUTOUT_FILES if include_cutout else frozenset())
        if not required.issubset(contents):
            raise ValueError("Archive is missing required build/deployment files")
        if not any(name.startswith("packages/server/src/") for name in contents):
            raise ValueError("Archive has no server source")
        if not any(name.startswith("packages/shared/src/") for name in contents):
            raise ValueError("Archive has no shared source")
        if expected is not None and set(contents) != expected:
            raise ValueError("Archive selection differs from source allowlist")
        return len(contents)


def create_bundle(root: Path, output: Path, include_cutout: bool) -> int:
    files = collect_files(root, include_cutout)
    output = output.resolve()
    if output.is_relative_to(root / "packages") or output.is_relative_to(root / "deploy"):
        raise ValueError("Output must not overwrite source files")
    if not output.name.endswith(".tar.gz"):
        raise ValueError("Output must end in .tar.gz")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                checksums = []
                for relative, source in files:
                    content = source.read_bytes()
                    add_file(archive, relative, content)
                    checksums.append(f"{hashlib.sha256(content).hexdigest()}  {relative}\n")
                add_file(archive, "SHA256SUMS", "".join(checksums).encode("utf-8"))
    count = verify_archive(output, {relative for relative, _ in files})
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_name(output.name + ".sha256").write_text(
        f"{digest}  {output.name}\n", encoding="utf-8", newline="\n",
    )
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--include-cutout", action="store_true")
    parser.add_argument("--verify", type=Path, help="Verify an existing archive without extraction")
    args = parser.parse_args()
    try:
        if args.verify is not None:
            if args.output is not None or args.include_cutout:
                parser.error("--verify cannot be combined with creation options")
            count = verify_archive(args.verify)
            print(f"Verified {count} allowlisted files: {args.verify}")
            return
        root = Path(__file__).resolve().parent.parent
        output = args.output or root / "artifacts" / f"jizhang-api-source-{date.today().isoformat()}.tar.gz"
        count = create_bundle(root, output, args.include_cutout)
        print(f"Created and verified {count} allowlisted files: {output.resolve()}")
        print(f"Size: {output.stat().st_size} bytes; checksum: {output.name}.sha256")
    except (OSError, ValueError, tarfile.TarError) as error:
        parser.exit(1, f"Bundle error: {error}\n")


if __name__ == "__main__":
    main()
