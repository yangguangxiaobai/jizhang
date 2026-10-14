# Bounded backup retention

## 1. Scope / trigger
Host maintenance under `deploy/api-production-tools`; not ledger APIs, image
startup, `/data/backups` application pruning or local-copy management. Operations
are detailed in `deploy/api-production-tools/RETENTION.md`.

## 2. Signatures
`retention.py` defaults to `preview`; explicit commands: `init`, `enroll <path>`
(optionally `--pin`, `--release`, `--offserver-receipt`), `attest <path>
--offserver-receipt <receipt>`, `preview --save-plan <plan>`, and `apply --plan
<plan> --approved-plan-sha256 <digest>`. No allowlist root override.
`manage.sh status|config|logs|up|backup` retains five exact signatures;
backup invokes existing consistent CLI with retain-days=0.

## 3. Contracts
Only explicitly enrolled direct-child regular private `.db` snapshots under
`/opt/jizhang-backups/retention` can become candidates. Protected registry/plan/
receipt JSON rejects duplicate keys recursively and nonfinite numbers. Verify
canonical parents, ownership/mode, no links/sidecars, stable identity and SHA256;
SQLite read-only integrity plus isolated backup/restore and required-table checks.
This proves readability, not application compatibility or full recovery acceptance.

UTC disjoint windows: [0,7) days all; [7,30) newest per ISO week; [30,180) newest
per UTC month. Always retain newest three DISTINCT verified hashes, pins and ALL
release-associated points; preserve every copy of retained hashes. Copies do not
create independent recovery points. Legacy, unknown, migration, config, archive,
image/source and off-server/local copies stay outside deletion scope.

Off-server receipt is operator attestation bound to hash/time, not remote proof.
Apply binds reviewed plan digest, registry/policy and 900-second validity. Recompute
and revalidate remaining recovery points, references, topology/health and shared
lock before EACH unlink. Fsync audit intent/result; stop on partial failure.

`manage.sh up`/`backup` and retention use the same protected root-owned 600
`/opt/jizhang-production/maintenance.lock`; provision BEFORE wrapper installation,
never replace inode. Direct/manual writers must cooperate across whole deployment
window; no atomicity claim against uncooperative root writers. No nested locking.
Snapshot transfer/enrollment is manual; no new daily backup cadence. Units are
source-only disabled templates; destructive placeholder runs false.

## 4. Validation / error matrix
| Condition | Outcome |
| --- | --- |
| Fewer than three distinct verified points | Keep all; apply blocked |
| Invalid enrolled point/new unverified backup | All deletion blocked |
| Unknown managed file | Individually unmanaged/pinned, never candidate |
| Missing retained off-server evidence | Apply blocked |
| Drift, expired plan, wrong approval digest, lock conflict/replacement | Fail closed |
| Unlink/audit/registry partial failure | Stop; operator reconciliation, no silent restore |
| Legacy/app/archive/image/source/local path | Outside apply scope |

## 5. Good / base / bad
Good: reviewed bounded plan with independently verified retained recovery points.
Base: one pinned enrolled snapshot, zero candidates, apply_ready=false; deployed
maintenance tool does not imply cleanup/recovery readiness. Bad: counting its three
copies as three points or inferring deletion permission from age alone.

## 6. Tests required
`python -m unittest discover -s deploy/api-production-tools -p 'test*.py' -v`:
UTC boundaries/week-year/month, duplicate/pin/release protection, invalid snapshots,
sidecars/links/unknown files, off-server receipts, drift/expiry/digest, lock conflicts,
partial unlink/audit errors. Linux real ownership/flock/inode/wrapper tests are
separate from Windows mock skips. Compile Python, `bash -n manage.sh`, LF/hash and
scoped whitespace checks. Remote deployment requires independent review and consent;
actual candidate deletion and schedule activation require later separate approval.

## 7. Wrong vs correct
Wrong: successful fresh backup automatically prunes old trees or enables a timer.
Correct: retain-days=0, manual completed-snapshot enrollment/attestation, reviewed
read-only preview, later actual-candidate approval. Never restore over live ledger
as maintenance rollback; revert only tools/schedule configuration.
