# Execution plan

## Approval gates
User explicitly approved final plan and local implementation in the delegated dispatch. Independent review precedes remote maintenance-only read-only rollout. No destructive server apply or timer activation until actual candidate report reviewed.

## Ordered work
- [x] Snapshot task-owned working-tree baseline; read maintenance/backup/native delivery specs and production wrapper.
- [x] Implement protected registry, scoped read-only inventory/enrollment validation, UTC tier selector and structured dry-run output; legacy defaults pinned.
- [x] Add explicit apply/revalidation/locking and audit code with fail-closed deletion boundaries; do not execute production deletion.
- [x] Prepare shared maintenance deployment-lock protocol and document limits; retain backup retain-days=0 and existing app policy.
- [x] Prepare daily systemd service/timer templates disabled by default; report-only rollout first.
- [x] Test tier boundaries, duplicate copies, minimum three, pins, corrupt/unknown/symlink files, off-server-copy evidence, candidate drift, lock conflicts and partial errors using temporary fixtures/mock commands.
- [x] Independent check PASS recorded in check-status.md; main dispatch explicitly approved maintenance-only rollout.
- [x] After implementation approval, upload checksummed maintenance-only tools; validate on server and generate dry-run without service restart or deletion. Inventory before/after prove production ledger/service unaffected.
- [x] Present retain/candidate/blocked list and bytes. Await explicit approval before deletion/scheduling; update deployment maintenance README/spec/evidence.

## Validation
- `python -m unittest discover -s deploy/api-production-tools -p 'test*.py' -v` (confirm actual test file naming first).
- `python -m py_compile` new/changed Python tools.
- `bash -n deploy/api-production-tools/manage.sh` and any new shell wrapper.
- Existing maintenance and source-bundle mock tests.
- Scoped `git diff --check`; preserve unrelated existing failures.
- Remote wrapper status, read-only tool preview, file permissions and unit-template validation without activating timers.

## Rollback
Save original maintenance files privately, retain CLI backup behaviour. Restore tool/wrapper files and disable only task-owned timer if activated later. Never roll back database data or alter Caddy/cutout/Komari. No Docker prune or source/image unlink in initial rollout.
