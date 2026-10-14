# Local implementation status

## Approval and boundary
Final plan/local implementation approved by delegated prompt. Remote delivery waits
for main-session independent review. No SSH, production deletion/apply, timer
activation, service restart, image change or ledger write performed. No commit,
push, merge or recursive implement/check dispatch. Baseline working tree captured
in baseline-status.txt and baseline-owned.diff; unrelated changes preserved.

## Owned files
- deploy/api-production-tools/retention.py: protected versioned registry, explicit
  enrollment and later off-server attestation, isolated SQLite restore verification,
  hash/stat/path/symlink/hardlink/sidecar checks, UTC tiers, distinct minimum three,
  pins/all release associations, deterministic preview, bounded reviewed-plan apply,
  cooperative flock, container references, topology/health, sanitized durable audit.
- deploy/api-production-tools/test_retention.py: selector/temp-SQLite/mock guards.
- deploy/api-production-tools/manage.sh: cooperative lock for up/backup; exact
  existing Compose topology/operations and retain-days=0 unchanged.
- deploy/api-production-tools/systemd/: disabled report templates; deliberately
  failing destructive cleanup placeholders, not automatic approval implementation.
- deploy/api-production-tools/RETENTION.md and README.md plus production README:
  installation prerequisite, manual consistent-snapshot transfer/enrollment,
  off-server operator evidence, review gates, lock limitations and excluded scope.
- Task prd.md/implement.md/todo.md and local evidence/status files.

## Validation (Windows Python 3.13 + Git Bash)
- unittest discover maintenance: 28 total, 27 passed, 1 Linux real-flock test skipped.
  Includes 9 pre-existing archive mocks. See local-tests.txt.
- python -m unittest deploy.test_source_bundle -v: 2 passed.
- py_compile retention.py/test_retention.py: passed.
- bash -n manage.sh: passed.
- scoped git diff --check: passed (Git emits autocrlf warnings only).
- All maintenance source bytes checked LF: passed.
- No TypeScript/API change; application lint/typecheck not run.
- Linux real ownership/flock/fsync/systemd and Docker/host acceptance pending;
  Windows fixtures mock root ownership/locking, not production evidence.

## Limitations / review targets
Dedicated /opt/jizhang-backups/retention root only, nonrecursive. Legacy/app/volume,
images/source/config/off-server copies never deleted. Off-server receipt is an
operator attestation, not remote proof. All release-associated points stay pinned;
no automated assessment of current/two usable prior rollback releases. No new daily
backup cadence. Destructive timer intentionally not operational. Unknown files
individually pinned; any invalid enrolled point blocks deletion globally. The tool
uses existing archive.py read-only Docker helpers, not its old image-specific guard.
Shared lock protects only participating writers; direct/manual deployment must
hold same inode for entire window. Partial unlink/audit/registry failures require
operator reconciliation; no silent rollback or continued cleanup. Most existing
space is protected legacy image exports; initial reclaimed bytes may be zero.
