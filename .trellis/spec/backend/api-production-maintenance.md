# API production maintenance handoff

## 1. Scope / Trigger
Known-server maintenance after the 2026-10-13 API cutover. User-confirmed runtime evidence is in `deploy/API-PRODUCTION-README.md`; this does not establish full Android acceptance.

## 2. Signatures
- `deploy/api-production-tools/manage.sh status|config|logs|up|backup`
- `python3 deploy/api-production-tools/archive.py [--apply]`
- Fixed project `jizhang`, production directory `/opt/jizhang-production`, external volume `jizhang_jizhang-data`.

## 3. Contracts
Wrapper sets the volume each invocation and merges base, migration, runtime and image override files in order, with private `.env`. `up` only recreates API with `--no-deps --no-build --pull never`. Archive defaults to dry-run and only renames fixed candidates; never deletes volumes, databases or images. Inspect all containers, including stopped ones, for mount and Compose references. Preserve worker-referenced legacy directories. Environment values and inspect/config JSON remain private.

## 4. Validation / Error Matrix
- Missing config or symlink: wrapper rejects.
- Docker inspect failure, malformed labels or inventory race: archive rejects.
- Candidate or parent mount/Compose reference: candidate blocked.
- Wrong production image, health, volume or config labels: apply rejects.
- Cross-filesystem move or symlink candidate: reject, never copy-and-delete.

## 5. Cases
Good: API updates on the same external volume while worker stays running.
Base: dry-run leaves worker-referenced `/opt/jizhang` blocked.
Bad: recreate from a historical Compose directory and create an empty volume.

## 6. Tests Required
`python -m unittest discover -s deploy/api-production-tools -p 'test_*.py' -v` checks default no-mutation, fail-closed inspect/inventory, parent mounts, stopped worker references, health/image/volume guards and malformed labels. Run `bash -n deploy/api-production-tools/manage.sh`. Mock tests do not prove actual server health or restore capability.

## 7. Wrong vs Correct
Wrong: delete all directories named jizhang or use `down -v`.
Correct: inspect references, archive only unused fixed candidates, keep data and rollback evidence; verify health, root JSON404 and old ledger. Mirror backups off-server. Roll back compatible images without restoring DB over newer writes.
