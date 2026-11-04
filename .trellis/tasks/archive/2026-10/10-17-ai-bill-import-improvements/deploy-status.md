# Merged bill import production deployment

Status: **DEPLOYED — production API switched and deployment checks passed; full feature acceptance remains incomplete**
Deployment tag timestamp: `20261017T154012Z` (task deployment label). Actual server capture/start times below are authoritative; server clock reported 2026-10-19 UTC.

## Authorization / scope

Production deployment authorization is recorded in `research/deployment-install-authorization.md`. This record covers server build, migration, API image switch and deployment checks only. No real provider request, user export, financial confirmation, master-data change, secret/model/timeout change, app-data clearing, unrelated service recreation, backup cleanup/retention, Git stage/commit/archive, or automatic database restore was performed.

## Deployment identity

| Item | Before | Deployed |
|---|---|---|
| Image tag | `jizhang:api-chained-choice-20261016T083118Z` | `jizhang:api-merged-import-20261017T154012Z` |
| Image ID | `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` | `sha256:5b92d4b599e5c73c3de6b265f76640797d155ecd36387ba5c1846ede7935a5bc` |
| API container | `0b5eb41efa7c396b8b49ad693c358a857029a8ff52ee576105262a12c5381ab1` | `9e0a199567868e52f3de95feea3627246ba3ebf0ead17dad8da49c83471cd560` |
| StartedAt | `2026-10-16T08:57:13.935239781Z` | `2026-10-19T05:47:53.949166436Z` |
| Runtime user / port | `node`, `127.0.0.1:8081` | `node`, `127.0.0.1:8081` |
| Data volume | `jizhang_jizhang-data:/data` | same |
| Networks | `jizhang_default`, `jizhang_cutout-internal` | same |

Rollback image tag retained: `jizhang:rollback-merged-import-20261017T154012Z` (old image ID above). Rollback procedure is to restore the saved image override and run the production wrapper. Do not restore the database over any post-switch writes.

## Source bundle and build

- Allowlist bundle: `.trellis/tasks/10-17-ai-bill-import-improvements/artifacts/merged-import-source.tar.gz`; 96 files, SHA256 `956beca58a59892bbdb0cd24b555d2be61d3721bb3b77ebf346b1e16c28b8750`.
- Included Dockerfile, `.npmrc`, required root/package manifests, lock/workspace/TypeScript configs, `deploy/db-manifest.mjs`, server/shared TypeScript source. Excluded `.env`, DB/key files, tests, Android/Web and unrelated WIP.
- Against the prior candidate bundle `jizhang-api-source-20261017T154012Z.tar.gz`: 96 common build files had **zero content differences**; the selected bundle intentionally omitted 12 deployment/docs/API-only helper files not required for the image build.
- Build completed with `docker build --pull=false`; protected build log and image ID are on host at `/opt/jizhang-backups/merged-import-20261017T154012Z/`.

## Backup and migration evidence

- A preflight CLI-consistent snapshot was discovered from the earlier preparation and validated before use. During fresh final preparation, the transaction count changed from 59 to 62; the first final comparison correctly stopped and restarted the original API. The later backup and baseline were captured together during the brief API pause, so the three newer transactions were preserved.
- Final SQLite CLI snapshot: `jizhang-2026-10-19T05-45-57-115.db`; server/off-server SHA256 match: `339baaf6bcedf3173587e630abc24cc2170dcffa6d3b7d0e9a29b200af72949f`.
- Off-server copy: `artifacts/backups/merged-import-20261017T154012Z/final-snapshot.db`; CLI manifest integrity `ok`; final pre-switch live manifest exactly matched this backup. The earlier snapshot remains preserved too; no historical backup was deleted.
- Isolated rehearsal on a copy of the pre-012 snapshot with candidate compiled migration: migration versions 1–11 → 1–12; exactly four new tables (`assistant_import_batches`, `assistant_import_batch_rows`, `assistant_import_batch_categories`, `assistant_import_batch_operations`); all old table schema/row hashes unchanged; `integrity_check=ok`; FK violations `0`; second `runMigrations()` applied no migrations.
- Production after switch: schema versions 1–12, the same four added tables, integrity `ok`, FK violations `0`. Every pre-existing non-`schema_migrations` table hash matches the quiesced pre-switch manifest. This includes the 62 transaction rows; no ledger rows were modified by migration.

## Environment and topology invariants

- Every explicitly composed environment value was compared with the running container in remote process memory before switch; all matched. Post-switch, old/new effective runtime values also matched (private env JSON was not emitted).
- `NODE_OPTIONS=--max-old-space-size=160` unchanged; AI configuration, credential values, session/config settings unchanged. No secret values or secret hashes were output.
- Same external data volume, `node` user, `127.0.0.1:8081` binding and two API networks.
- `caddy`, `jizhang-cutout`, and `komari` container IDs and running states unchanged; no dependency was recreated. IDs: Caddy `1c193e276ec9…`, cutout `72b7d257007c…`, Komari `d39ea46deede…`.
- Production was switched only through `image.override.yml` and `/opt/jizhang-production/manage.sh up`; wrapper semantics are API-only `--no-deps --no-build --pull never`.

## Runtime/public verification

Candidate image was separately run against a tmpfs database using the protected runtime environment, not production data. Candidate started, applied versions 1–12 and exposed all four tables. Probe results: health 200, root JSON 404/`NOT_FOUND`, unauthenticated batch read 401. The temporary probe was removed.

After switch, public HTTPS outcomes were:

- `GET https://jz.yansuu1.xyz/api/v1/health` → 200, JSON status `ok`.
- `GET https://jz.yansuu1.xyz/` → 404, JSON error code `NOT_FOUND` (API-only behavior).
- Unauthenticated batch GET → 401.
- Mutation without CSRF header → 403. The request used a nonexistent conversation and made no write.
- Running image contains compiled `dist/routes/import-batches.js`; inspected registrations include create, batch/rows/categories/duplicates reads, review, analyse, file remove/replace, confirm and cancel endpoints.

No authenticated mutation or real merged bill import was executed. No provider call or financial confirmation was made.

## Progress

- [x] Read authorization, task contract, frozen protocol, deployment instructions and prior deployment evidence.
- [x] Read-only preflight; lock/config/active-work/schema/topology checks.
- [x] Allowlisted source package, source-diff comparison, environment equality, independent build.
- [x] Consistent off-server backup and isolated migration rehearsal.
- [x] Candidate temporary-DB runtime and public-route probes.
- [x] Final quiesced backup, API-only image override/switch and post-switch invariants/public health/auth/root/CSRF checks.
- [ ] Complete overall task feature acceptance, independent review/check workflow, and representative real-export budget calibration. This deployment does not close those gates.

## Remaining acceptance and evidence limits

- Full authenticated end-to-end Android merged-import flow, real CSV/XLSX exports, provider behavior and actual user review/confirm are not verified here and were not attempted.
- Real-export resource calibration remains outstanding. A previously measured synthetic stress test has a fixture defect: its harness configured 10 source rows but emitted only 9, so it did **not** demonstrate the intended 5,000-row / 16 MiB case; under `strict:false` it also returned a 33,382,080-character ZIP comment and measured about 1.33 GiB Node heap. This is a synthetic test-harness defect, not evidence of a production regression. Do not claim the large-batch benchmark passed; task acceptance must track correction and real-export calibration separately.
- The package’s earlier local focused test log (`artifacts/tmp-test.log`) shows 15/17 passing with two failures (`import-batch-confirm`: failed-file workspace helper assumes `row.fallback`; cancel idempotency mismatch expected 409 but got 200). That log is not a post-deployment verification and remains an open code/test acceptance item pending current task check. Deployment success does not imply those cases pass.
- No rollback was needed. If rollback becomes necessary, preserve any newer writes and switch only the image; do not automatically restore the snapshot.

## Evidence paths

- Task-local deployment summary and public/topology/schema evidence: `.trellis/tasks/10-17-ai-bill-import-improvements/artifacts/production-deploy-20261017/`
- Source bundle + checksum and source manifest: `.trellis/tasks/10-17-ai-bill-import-improvements/artifacts/merged-import-source.tar.gz`, `.sha256`, `source-manifest.txt`
- Final and initial off-server snapshots: `artifacts/backups/merged-import-20261017T154012Z/`
- Protected host build, private inspect/env evidence, source checksums, backup, logs and rollback configuration: `/opt/jizhang-backups/merged-import-20261017T154012Z/` (not copied into repository)

A few initial operational probes failed safely before switch: environment equality first included image-baked Node defaults; a probe omitted required login env; tmpfs permissions were initially wrong; a rehearsal container exited before `exec`; final backup comparison first used a stale manifest; and one switch attempt held the maintenance lock while invoking the lock-taking wrapper. Each issue was corrected without changing production data/config/image; the original API was restarted after the unsuccessful backup-preparation attempts. The final verified switch and results above are the authoritative evidence.
