# Independent deployment and install verification

Date: 2026-10-19 UTC  
Scope: read-only reconciliation of the task's deployment/install claims against production runtime state, public endpoints, deployment source bundle, existing task evidence, and currently available ADB state. No deployment, install, database write, provider call, product change, full test run, Git staging/commit, or task-status change was performed.

## Result summary

- **Production deployment: PASS (independent scoped check).** The live API is the reported merged-import image/container, healthy, on the expected runtime user, volume, loopback port and networks. Migration versions 1–12 and the four expected tables are present; SQLite integrity and foreign-key checks pass. The unchanged 21 pre-existing non-schema tables matched the pre-switch snapshot at deployment time. A current comparison against that snapshot shows exactly one later change: `transactions` moved from 62 to 63 rows. The four new batch tables remain empty. This is evidence of a post-deployment transaction write, not evidence that migration changed ledger data; do not claim current tables all still hash-match the pre-switch snapshot.
- **APK install: PASS based on the contemporaneous install record; current device state not independently readable now.** Existing task evidence records `install -r` success, preserved first-install time, installed base APK byte-identical to the local APK, and matching signer. The current local APK SHA-256 still matches the recorded hash. ADB currently lists no connected devices, so current `pm path`, version or install-time cannot be refreshed without a connected device.
- **Not established:** full merged-import feature acceptance, authenticated end-to-end operation, provider behavior/benchmark, real-export budget calibration, actual bill import/financial correctness, or broad Android/device acceptance. No full tests/provider calls were rerun.

## Live production observations

Read-only SSH as the existing deploy operator was used for Docker inspect, SQLite read-only queries/manifest generation, and protected backup-manifest comparison. No environment values or secret hashes were emitted.

- API container ID: `9e0a199567868e52f3de95feea3627246ba3ebf0ead17dad8da49c83471cd560`.
- Image tag/ID: `jizhang:api-merged-import-20261017T154012Z` / `sha256:5b92d4b599e5c73c3de6b265f76640797d155ecd36387ba5c1846ede7935a5bc`; running and Docker health `healthy`.
- Runtime user `node`; `/data` uses `jizhang_jizhang-data`; published `8081/tcp` is bound only to `127.0.0.1`; networks are `jizhang_default` and `jizhang_cutout-internal`.
- `NODE_OPTIONS` remains `--max-old-space-size=160`. Compared 14 effective environment keys with the protected post-deploy inspect; all matched. Values and digests were not printed.
- `caddy`, `jizhang-cutout` and `komari` are running with the same container IDs and start times recorded in the deployment evidence. No dependency was recreated.
- The deployed compiled image contains `dist/routes/import-batches.js` and `dist/db/migrations/012-import-batches.js`.
- Read-only SQLite checks: migration versions exactly 1–12 (12=`import-batches`); all four tables exist (`assistant_import_batches`, `assistant_import_batch_rows`, `assistant_import_batch_categories`, `assistant_import_batch_operations`); `integrity_check=ok`; `foreign_key_check` has 0 violations. All four batch tables currently contain 0 rows.
- Current `transactions` count is 63. The final pre-switch manifest has 62. A privileged, read-only comparison against that protected pre-switch manifest found all **21 pre-existing non-`schema_migrations` tables** unchanged except `transactions`; this confirms one post-snapshot transaction row. The deployment-time artifact comparison (`before-final-manifest.json` vs `after-manifest.json`) had all pre-existing non-schema hashes unchanged and 62 transaction rows on both sides, while adding the four new tables.
- Public probes during this check: `GET /api/v1/health` → 200 / `status=ok`; `GET /` → 404 JSON `NOT_FOUND`; unauthenticated batch GET → 401. Existing deployment evidence also records unauthenticated mutation → 403 for missing CSRF header. No authenticated mutation was attempted.

## Bundle and source correspondence

- Recomputed the source archive checksum: `956beca58a59892bbdb0cd24b555d2be61d3721bb3b77ebf346b1e16c28b8750`, matching the recorded archive checksum.
- Inspected the archive member hashes against `artifacts/source-manifest.txt`: all 96 manifest entries match; the archive contains one additional `SHA256SUMS` file. There are no missing manifest files or content mismatches.
- The allowlisted bundle includes the batch route and migration 012; each archive file hash matches both the source manifest and current working-tree file. This supports that the service and schema migration were in the deployed build input. The deployment summary records the resulting production image ID, and the live container uses that exact image ID.

## APK evidence and present limitation

`artifacts/merged-import-device-install/install-verification.json` and `taskdevice-status.md` record the 2026-10-19 install to device serial `TNL0220A15028072`: `install -r` exit 0 / `Success`, unchanged first-install time, version 0.1.0/code 3, pulled installed `base.apk` byte-for-byte identical to the requested local APK and signer match, plus a limited `MainActivity` render smoke. Current local APK SHA-256 is still `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`. `adb devices -l` now shows no attached device; I therefore did not claim a fresh current-device package-path/version/install-time check. The saved install evidence is direct contemporaneous proof, not a claim that the device remains connected or the app remains installed today.

## Stale/local failure-log reconciliation

### `artifacts/tmp-test.log`

- This exact file exists, is 5,450 bytes, and has filesystem modification time **2026-10-17 15:57:50 +0800**. Its embedded Vitest run began 15:55:49 and reports 15/17 passing with two failures in `import-batch-confirm`: the failed-file workspace helper dereferenced missing `row.fallback`, and a cancel idempotency expectation was 409 while actual was 200.
- This timestamp is before the production image switch at `2026-10-19T05:47:53Z`. The log contains no source revision/hash, so it cannot establish whether those failures persist in the deployed source or current working tree. Treat it as **historical/pre-deployment local test evidence, not current red/green status**. It was not rerun, and neither failure is asserted to be a live production blocker from this log alone.

### Synthetic heap stress note

- `deploy-status.md` references an earlier synthetic stress harness defect: configured 10 source rows but emitted 9; it did not exercise the intended 5,000-row/16 MiB condition, and under `strict:false` produced a 33,382,080-character ZIP comment and about 1.33 GiB Node heap.
- The referenced measurement log/harness run is not present in the task artifacts searched for this check; no timestamp/source hash could be tied to the currently deployed source. Consequently this observation remains **historical and not a current performance result**. It does mean the old run cannot support passing a 5,000-row stress gate. The final quality readback separately records synthetic generated-input benchmarks (latest stated 500 CSV rows, 97 ms / +6.6 MiB; distinct from earlier runs), and explicitly says genuine-export calibration is incomplete. No production resource-safety or provider benchmark pass is claimed.

## Evidence boundary

The evidence supports that the API deployment and additive migration are live and healthy, and that the APK was installed and byte-verified at the recorded time. It does **not** close the overall feature task: no current authenticated import flow, real provider request/behavior, genuine export resource calibration, or financial confirmation was tested. Historical local failures and heap notes are not silently upgraded into current failures or current passes. No secret, environment value, private export, or credential was included in this report.
