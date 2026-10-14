# Maintenance-only deployment evidence — 2026-10-14

Status: PASS for approved maintenance-only installation and read-only preview.
Independent check PASS preceded deployment. SSH used jizhang_deploy and sudo -n.
No apply/unlink, enrollment, database generation/copy/read of ledger contents,
container recreation/restart, image update, production config edit, timer install/
activation or Git commit performed. Advisory /data/backups inventory used only
readdir/stat through node, not SQLite or ledger queries.

## Installed scope and rollback
- /opt/jizhang-production/manage.sh, archive.py, retention.py: root:root 700.
- /opt/jizhang-production/maintenance.lock: root:root 600, created O_EXCL once;
  real Linux exclusive flock conflict test refused competing preview.
- /opt/jizhang-production/retention-state and /opt/jizhang-backups/retention:
  root:root 700; canonical root-owned ancestors, no group/other write permission.
- registry.json, initial.plan.json and initial-preview.json: root:root 600.
- A deployment-time RETENTION.md copy is private in retention-state (later local
  status clarification is documentation only; reviewed executable bytes unchanged).
- Private old manage.sh/archive.py and before.json:
  /opt/jizhang-production/maintenance-rollback-20261014T043831Z.
- Private staging remains /tmp/jizhang-retention-delivery.rR2Dnx2U; no cleanup
  deletion executed under the no-deletions dispatch.
- No retention systemd units found in /etc, /run or /usr/lib/systemd/system.

Reviewed installed SHA256:
- retention.py: 4e0db235b0984f8efb233461f4f471f2de4e94c2457f98e551a68baae6000339
- archive.py: 555dd329e036b6e2cb760d28f39dafc10deaee489fa5189eff3088c362f2767d
- manage.sh: 954520b1a8da003eb881ee1643673c7ff840e6fbc06a31469aa89c7066c93838

## Actual initial preview
UTC: 2026-10-14T04:38:31.982902+00:00.
Plan SHA256: 91cf6ad28d547e4ade3e3df218a70c25ff78e2b1025562cab8b3e936a65a8ef9.
Registry digest: 744bb2eff2714827e1e99a0e986bd1013a78e07a8361abdb17164c5b39e846a8.
Policy digest: ffadd64b4e7db43f204e3f7499d4c1dbfa7b9f5291a195719148375a97867907.

| Class | Count | Bytes | Explanation |
| --- | ---: | ---: | --- |
| Managed candidates | 0 | 0 | Registry and managed root empty |
| Managed retained | 0 | 0 | No enrollment; not evidence of three recovery points |
| Managed blocked/unmanaged rows | 0 | 0 | rows=[] |
| Legacy host DB paths | 9 | Included in host aggregate below | Unmanaged/protected, not independently verified points |
| All legacy host backup files | 83 | 3,288,433 | Config/history/DB; no classification-based deletion |
| App backup DB paths | 8 | 2,588,672 | /data/backups outside managed apply scope |
| Historical archive files | 1,074 | 649,814,782 | Unmanaged/protected; historical ~626 MiB allocation untouched |
| Current source upload files | 457 | 5,157,913 | Report-only/protected |

apply_ready=false; distinct_verified=0; newest_verified_at=null. This is a
successful empty preview, NOT cleanup or recovery-readiness success. Bytes above
are summed regular file logical sizes, not du allocation measurements.
Before/after legacy file count/inode/size/mtime/mode inventory digests matched for
backup/archive/upload trees (managed root deliberately excluded). No legacy file
moved or removed; contents were not read for this inventory.
Saved plan is historical evidence, not ongoing approval; plans expire in 900s.

## Production invariants
All five container IDs/image IDs/start times/states matched before/after; exact
sanitized records in remote-rollout-output.txt. API ID:
a3c3e93215786a4d9fc02d7afcbf66e632e7d88358ac8e52084d43d2731c65ef.
API image: jizhang:api-bill-import-20261014T034500Z,
sha256:2b714dc7cb513a7d165be03f0244977a342efd7e0f285b57517f206c47f2fbac.
API start: 2026-10-14T03:50:08.337357898Z; running/healthy throughout.
Cutout stayed healthy; Caddy/Komari running; boring_colden remained exited.
Original named /data volume and fixed project/service/working_dir/four-config
labels validated. Five production config/.env byte digests matched internally;
no values/digests of secret files exported. manage.sh config/status passed.
Public health HTTP 200, root HTTP 404. This is infrastructure evidence, not a
fresh ledger comparison or Android/device acceptance; ledger contents untouched
by task commands, not asserted immutable against concurrent app writes.

## Validation and follow-up
Remote installed Python compile() and bash -n passed without production pycache;
all executable bytes LF and checksums matched independent review. Permissions and
real flock refusal checked on Linux. Local maintenance tests: 34 run, 31 pass,
3 Linux-specific skips; prior independent Linux fixture check ran all 34 PASS.
Local py_compile/bash -n passed. No application code touched by this rollout.
Future manage.sh backup retains existing CLI output/retain-days=0. It DOES NOT
copy/enroll automatically. RETENTION.md documents exact completed snapshot staging,
locked transfer to managed root, manual enroll and off-server operator attestation.
Obtain separate actual-candidate approval for any later deletion or scheduling.
Rollback only tool bytes: in a quiet cooperative lock window, restore privately
saved scripts via install root:root 700; never restore/overwrite live database,
remove historical evidence or replace lock inode. Leave protected registry/state
unless separately reviewed. No schedule needs disabling because none installed.
