# Existing bill-import snapshot enrollment — 2026-10-14

Status: PASS for explicitly authorized copy/enrollment and read-only preview.
Remote completion: 2026-10-14T05:28:24.063587+00:00.
No fresh production snapshot generation, live database access, API/config change,
restart/recreation, deletion/apply, timer activation or Git commit.

## Snapshot and actual evidence

- Provenance: existing successful WAL-consistent CLI snapshot from bill-import
  deployment; prior task `10-13-wechat-import-review/deploy-status.md` records
  generation, original-volume location and host/off-server transfer.
- Original preserved: `/opt/jizhang-backups/bill-import-20261014T034500Z/database/jizhang-2026-10-14T03-45-59-017.db`.
- Local preserved: `artifacts/backups/bill-import-20261014T034500Z/jizhang-2026-10-14T03-45-59-017.db` (gitignored).
- NEW independently stored managed COPY: `/opt/jizhang-backups/retention/jizhang-2026-10-14T03-45-59-017.db`.
- All copies match SHA256 `d6a564f7a541a50beae117f384ef9c048144065e1d6d5dea04fc401524230161`, 434176 bytes.
- Local verification at 2026-10-14T05:27:18.772722+00:00: immutable read-only
  integrity_check; SQLite backup API to isolated temporary database; restored
  integrity_check and users/transactions/schema_migrations table presence; stable
  source identity and post-check hash. No rows printed. First full-stat assertion
  included read-sensitive atime; rerun used device/inode/size/mtime/ctime identity
  and succeeded. No content/hash mismatch occurred.
- Server managed verification repeated by reviewed tool during enrollment and
  previews: `isolated-sqlite-restore-v1`. Copy created O_EXCL/no-follow, fsynced,
  root:root 600, single hardlink, no sidecars; source unchanged.
- Truthful off-server OPERATOR ATTESTATION: receipt_id
  `local-bill-import-isolated-20261014-01`, above actual UTC time and SHA256.
  Remote receipt: `retention-state/local-bill-import-20261014-01.receipt.json`,
  root:root 600. Registry root:root 600.
- Enrolled `pin=true`, release `api-bill-import-20261014T034500Z`.
  This binds/protects the snapshot; does not prove image/application compatibility,
  credential availability or full ledger-total recovery acceptance.

## Actual dry-run

Saved preview time: 2026-10-14T05:28:23.880585+00:00.
Plan SHA256: `6719b452244094deb8a035ccc33428fcfc7b93d920bab1a44805a614a3a62238`.
Registry digest: `00a889a6dc82d97031738fc8634566aae2078186078601168f6b060078e767dd`.

| Class | Points/files | Bytes | Reasons |
| --- | ---: | ---: | --- |
| Managed retained | 1 / 1 | 434176 | latest-three-distinct, pinned, release-associated, recent-seven-days |
| Managed candidates | 0 / 0 | 0 | None |
| Managed blocked/unmanaged | 0 / 0 | 0 | No invalid enrolled point or unknown managed file |

`distinct_verified=1`, `apply_ready=false`: minimum three verified distinct hashes
is not met. Original/local/managed copies are ONE recovery point, never three.
Off-server evidence is present, but cannot override the minimum. The reason
`latest-three-distinct` means membership in the newest up-to-three selection,
NOT that three points exist. Newest snapshot: 2026-10-14T03:45:59.017000+00:00.
Follow-up public CLI preview at 05:28:39Z agrees, digest
`c7584cb28d59d582cf223884ecdac1be505aa9311b6249df7c90759e80b21c4e`.
These are historical plans, not approval for apply (900-second expiry).
Remote private saved files: `retention-state/bill-import-enrollment.plan.json`
and `retention-state/bill-import-enrollment-report.json`.

## Production invariants

- All five container IDs, image IDs/tags, start times, states and health match
  before/after. API ID `a3c3e93215786a4d9fc02d7afcbf66e632e7d88358ac8e52084d43d2731c65ef`,
  started 2026-10-14T03:50:08.337357898Z, current bill-import image unchanged.
  API/cutout healthy; Caddy/Komari running; boring_colden remains exited.
- Original /data named volume and fixed Compose topology validated. Five config/
  .env content hashes compared only in memory; no values or secret-file hashes
  exported. `manage.sh config` passes.
- Legacy backup/archive/upload file inventory digests unchanged (managed root
  excluded). Original host snapshot identity/hash unchanged. Local hash unchanged.
- Reviewed retention.py/archive.py/manage.sh hashes match deployment evidence;
  no server executable or production config edited. Shared lock inode preserved;
  transfer and enrollment use cooperative locking without recursive wrapper lock.
- No retention units in /etc, /run or /usr/lib/systemd/system before/after;
  no install/enable/start operations issued. Public health HTTP 200, root HTTP 404.
- No ledger comparison performed; user app may write concurrently. Statements
  concern task commands and infrastructure invariants, not immutable live data.

## Files and follow-up

Evidence: `offserver-verification.json`, `enrollment-remote-output.txt`,
`enrollment-followup.txt`; one-off auditable stdin orchestration `enroll-existing.py`
was NOT installed as server executable and is intentionally non-idempotent.
Re-running it refuses existing entries/files; do not reset state to retry.
`deploy/api-production-tools/RETENTION.md` now includes a precise manual
next-deployment checklist, snapshot-supported release semantics, off-server
verification, lock boundaries and failure handling. Documentation changes are
local only; remote reviewed executable bytes remain unchanged.

Tools STILL require manual completed-snapshot transfer/enrollment and honest
operator attestation. No automatic daily backup cadence or destructive cleanup is
active. Historical archives/app backups remain unmanaged/protected. Future actual
candidate deletion or scheduling requires separate approval. Do not fabricate more
points or create fresh production backups under this completed enrollment scope.

## Local verification

Maintenance unittest discovery: 34 run, 31 pass, 3 platform-specific Linux skips
on Windows; no failed tests. One-off orchestration syntax compilation and LF
checks passed. Scoped documentation diff check passed. No application code changed;
application lint/typecheck/device acceptance were not rerun for this ops/docs scope.
