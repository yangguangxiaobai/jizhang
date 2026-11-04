# Production deployment evidence

## Authorization and result
User explicitly authorized this subsequent production API update, superseding the original planning no-deployment boundary. Deployment completed at **2026-10-14T03:50:15Z**, through `/opt/jizhang-production/manage.sh` only. No commit, production bill insertion, login credential retrieval, provider invocation, database restore, Caddy reload or dependency recreation was performed.

## Deployment checklist
- [x] Read task curated context, implementation/check reports, production runbooks, source bundler and actual production wrapper.
- [x] Verify SSH/sudo and expected production topology; protect rollback configuration and tag.
- [x] Generate/verify/upload allowlisted current server/shared bundle; verify remote SHA and per-file manifest.
- [x] Generate CLI-verified WAL-consistent backup; copy to protected host path and gitignored off-server artifacts; compare SHA.
- [x] Build unique image without changing running services.
- [x] Change only `services.jizhang.image`, wrapper config/up/status, health/API-only verification.
- [x] Verify read-only manifests, immutable runtime configuration, original volume/network/non-root, dependency IDs and deployed analysis code.
- [x] Record evidence and outstanding APK/live-provider acceptance.

## Images and source
- Previous: `jizhang:api-2026-10-12`, `sha256:21340743ce31a1b795b550a73473273a1f86cabd213f80fc18962b3945b0458a`.
- Retained rollback: `jizhang:rollback-bill-import-20261014T034500Z`, pointing to that previous image.
- New: `jizhang:api-bill-import-20261014T034500Z`, `sha256:2b714dc7cb513a7d165be03f0244977a342efd7e0f285b57517f206c47f2fbac`.
- Bundle: `artifacts/jizhang-api-source-20261014T034500Z.tar.gz`, 95 allowlisted files, 273801 bytes. SHA256 `497ecc9a9cd241ed66256a3bfc536b87be7ffb890849ff8821798785b31ba1cc`.
- Includes `.npmrc` and `deploy/db-manifest.mjs`. Excludes real environments, credentials, databases, backups, native clients, task snapshots and generated output. Bundle unittest suite: 2 tests PASS; local/remote archive verification and remote SHA256SUMS PASS.
- Remote build: `/opt/jizhang-upload/build-20261014T034500Z/jizhang-api-source`; private build log below the protected evidence directory.

## Protected backups and evidence
- Host evidence/config: `/opt/jizhang-backups/bill-import-20261014T034500Z/`; directory mode 0700, saved configuration/database files 0600. `.env` remains private and unchanged.
- Consistent CLI backup in original volume: `/data/backups/production-handoff/jizhang-2026-10-14T03-45-59-017.db`.
- Protected host copy: `/opt/jizhang-backups/bill-import-20261014T034500Z/database/jizhang-2026-10-14T03-45-59-017.db`.
- Off-server local copy: `artifacts/backups/bill-import-20261014T034500Z/jizhang-2026-10-14T03-45-59-017.db` (gitignored; never inspected/output as ledger contents).
- Backup SHA256 matches host/local: `d6a564f7a541a50beae117f384ef9c048144065e1d6d5dea04fc401524230161`.
- Private files include before/after manifests, safe topology projections, config hashes, verification JSON, CLI/build/checksum logs and HTTP results. No database contents or secrets recorded in this report.

## Actual server checks
- Wrapper merged configuration valid; `up` uses `--no-deps --no-build --pull never` for API only.
- API container `a3c3e93215786a4d9fc02d7afcbf66e632e7d88358ac8e52084d43d2731c65ef` running healthy on new exact image.
- Public health returns `status: ok`; public root HTTP 404 with JSON content type and parseable JSON. Read-only `check-api-only.mjs https://jz.yansuu1.xyz` PASS.
- Read-only before/after integrity `ok`, **20 tables; every table count and content digest identical** (session differences were permitted by verifier but none occurred).
- Original volume `jizhang_jizhang-data` at `/data`, networks `jizhang_default` and `jizhang_cutout-internal`, runtime user `node` and loopback binding `127.0.0.1:8081` preserved.
- `.env`, base/migration/runtime Compose and wrapper hashes unchanged; only image override tag substituted, other override bytes/fields preserved.
- Caddy `1c193e276ec9`, cutout `72b7d257007c`, Komari `d39ea46deede`: exact full container/image IDs and topology compared unchanged. Cutout remains healthy. Caddy/Komari do not expose a Docker Health field; no healthcheck claim made for them.
- Deployed compiled `services/bill-import-analysis.js` and `/api/v1/assistant/actions/:id/analyse` route found in actual running container; this is code-presence evidence, not authenticated functional/device acceptance.

## Guarded first attempt and rollback
Initial post-switch verifier compared Docker mount arrays positionally. Docker returned identical Caddy mounts in a different order, producing a false mismatch. The EXIT guard immediately restored the old image override, wrapper config/up/status and old health; root remained JSON404, database was not restored. Safe before/after projections proved Caddy exact IDs and mount content unchanged; no actual topology change occurred. First-attempt evidence retained privately in `first-attempt/`. Corrected only the local verification helper to sort mounts by destination, then repeated the switch and passed all checks. Old image and private rollback configuration remain available. A later optional status format encountered absent Health fields on Caddy/Komari; authoritative exact-ID/topology verification and API checks had already passed, and this did not mutate services.

## Still outstanding
Server deployment does **not** update the installed Android APK. Install/update the rebuilt APK separately before using reviewed category/note UI. Previous code-check evidence: shared 176 tests, server 489 tests, Android 20 tests plus lint/build PASS. No live provider/device/import acceptance performed here. Up to eight sequential provider batches can still exceed Android's existing **90-second** read window; latency/custom-template compatibility and real-device review/persistence remain open, not solved by deployment. No production test bill or provider call is authorized implicitly by this report.
