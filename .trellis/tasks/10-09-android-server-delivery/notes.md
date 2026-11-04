# Execution record

- 2026-10-09: user explicitly approved the final plan with `开始`.
- Parent and all three delivery children activated via task.py start.
- Native Trellis implement agents assigned Android, API-only server and Docker/Caddy scopes with disjoint ownership. Current main-session task is android-production-ready.
- Main owns task coordination, spec updates, .gitignore native cache/signing exclusions and infrastructure integration.
- Web source removal remains gated on Android full parity acceptance and contract extraction; stage 1 Web hosting retirement proceeds independently.
- Infrastructure currently has Java 17 and Android SDK, but adb reports zero devices and Docker command is absent. SSH/topology details requested asynchronously; do not claim image/device/server validation.
- Existing unrelated skill/tool edits remain untouched and excluded from task commits.

- Final domain confirmed by user: jz.yansuu1.xyz (supersedes earlier .com). User reports no SSH; prepare a manual Ubuntu-terminal deployment instead of claiming remote installation.


## Observed production topology (user terminal output, 2026-10-09)

- caddy: image caddy:2, network host. Host-network Caddy can use 127.0.0.1:8081; no shared-network Caddy overlay is needed. Validate/reload via docker exec after inspecting its actual config mount.
- jizhang: image jizhang:64be4b1, networks jizhang_cutout-internal and jizhang_default.
- jizhang-cutout: image jizhang-cutout:64be4b1, network jizhang_cutout-internal.
- komari is unrelated and must remain unaffected.
- Previous blanket container-Caddy/shared-network assumptions are superseded by this inspected host-network topology. Actual /data mount, Compose working directory and Caddy config mount are still unknown; obtain read-only inspect output before migration.


## Confirmed production mounts (operator inspect output)

- Existing application Compose working directory: /opt/jizhang.
- Existing /data mount is named volume jizhang_jizhang-data, source /var/lib/docker/volumes/jizhang_jizhang-data/_data.
- Existing published API port: 127.0.0.1:8081 -> container8081.
- Caddy binds /opt/caddy/etc -> /etc/caddy read-only, /opt/caddy/data -> /data and /opt/caddy/config -> /config read-write. Preserve certificate/state directories. The actual active Caddy config file still needs confirmation.
- Select the named-volume migration overlay with JIZHANG_DATA_VOLUME=jizhang_jizhang-data. No Caddy network overlay. Existing Compose project label, .env presence, Compose version and available build memory remain to be verified before image upgrade.


## Operator preflight and initial backup

- Online consistent backup succeeded: /data/backups/pre-api/jizhang-2026-10-09T08-03-40-595.db, 20 tables, 308.0 KiB (operator CLI output).
- Docker Compose2.40.3+ds1-0ubuntu1, memory7.5Gi total/5.6Gi available, swap2.0Gi unused. Sufficient apparent capacity for API image build; actual build still pending.
- Caddyfile reported /opt/caddy/etc/Caddyfile, root-owned; original /opt/jizhang/.env reported mode600 (operator last line truncated, contents never requested).
- Next: upload the verified source archive+SHA256, unpack into a NEW directory, verify internal manifest, securely copy old .env and build exact API image tag while old service stays up.
- Before cutover, take a new quiesced snapshot and run the isolated restore/manifest drill; initial online backup does not cover later writes. Preserve Caddy state and existing cutout worker.


## Production-host image build evidence

Operator verified the outer SHA256 and all105 source manifest entries. New image jizhang:api-2026-10-09 built successfully on the Ubuntu host in69.8s (26steps). Builder compiled shared/server only; runtime production dependencies and db-manifest copied successfully. Manifest listsha256:226abee3cc1b3e0f9ea841046335c48b9d9512ff3308531a9d55e05391d76ab7. Bake/buildx warning was non-blocking. Existing service was not switched.

Next gate: use the consistent08-03-40-595 snapshot to restore into a unique isolated volume with the old data volume mounted read-only; compare table counts/digests and verify new image runtime before maintenance cutover. Do not restore into production or stop existing services for this isolated drill.


## Isolated restore verification passed

Operator created jizhang-api-check-20261009-163820 and restored the consistent production snapshot with the original data volume mounted read-only. New-image restore CLI succeeded; db-manifest comparison returned no diff and RESTORE_CHECK_OK. This confirms new-image SQLite runtime can restore/read this snapshot and its table counts/digests match. The restored volume is isolated from production. Next: start trial API on loopback18082, verify health/root404/non-root user before cutover; final production snapshot still required after stopping writes.


## Trial API startup verified

Operator started jizhang-api-check from the new image with isolated restored volume and loopback18082. Health returned200/statusok/version0.1.0, root returned404, whoami returnednode. New image build, SQLite restore/read/digest integrity and non-root API startup are now verified on the production host without changing the original running app.

Next cutover gate: scoped helper will preserve original image/config/inspect privately, validate original project/data/network identity, quiesce only jizhang, create a fresh consistent backup, and recreate only API service with the same named volume and retained cutout worker. Live root and APK/auth acceptance remain pending.


## Reviewed operator cutover helper ready

Delivered artifacts/cutover-known-server.sh17225bytes, SHA256dd7541cccac05a981df2071eec3ecfb6a7c09b70ee09af84275d0c3664894ab6. Matches deploy/cutover-known-server.sh byte-for-byte. Parent independently ran Bash syntax/checksum and python -m unittest deploy.test_cutover -v:4tests/11failure+success scenarios pass32.216s. All mock Docker/HTTP calls isolated, no remote operations.

Helper preflight guards topology, actual runtime secrets/AI key/default TTL, source manifest and prepared model before stopping; stores protected recovery material outside sources, tags old image, refreshes final snapshot/cold archive, recreates onlyAPI and verifies final ledger/mount/user/health with worker/Caddy IDs unchanged. Pre-recreate failure restarts old app; post-recreate failure stops new and gives manual recovery, without automatic data overwrite. Operator execution/live HTTPS remains next gate.


## Operator preflight NODE_OPTIONS mismatch and fix

Uploaded first helper passed topology but rejected effective NODE_OPTIONS before any container stop. Rootcause: baseCompose hardcodedheap256 overrides env_file; original actualruntime differs. Narrowfix captures oldliteralNODE_OPTIONS in private runtime override and includes it in model/up/recovery/durablecommands, equality guards retained; no immutable source or image change.

Exact-CLI private config-only sentinel detects raw/canonical doubled-dollar serialization and normalizesone layer only if provenescaped, preservingliteral$$. Official Compose2.40.3/5.6 fixtures checked. Updated helper/artifact19443bytes SHA256debca4400400b57f2373448a9a56b66bf0f49537d94edb0ebb769f4f10e33454; sidecarLF/sourceidentity independentlyverified. Revised operator upload/preflight stillpending; originalAPI/worker/Caddy remain running.


## Partial cutover recovery and live API observation

Operator applied helper: final coldbackup/archive2.42MB stored /opt/jizhang-backups/cutover-20261009T095502Z-2851966; new API started and passed health/root404/node/image/originalvolume/worker+Caddy-ID checks, then falsefailedAppnetworktext comparison. Helper stoppednewAPI, didNOTrestoreDB. Cause: Dockerprintlnplusformatterextra newline becameleading space aftersort/tr; mock lacked that extra newline. Guard fixed toJSONexactkeys andsharedprivateNetworkID; targeted4cases+successchecked. Updated futurehelper SHA96182525268b315dd89c4fdbdba44a5dc9873088dbe870db6d21b250abaa84eb; doNOTrerunold-cutoveronnewimage.

Operator JSONguard confirmed networkkeys jizhang_cutout-internal,jizhang_default and startedexistingnewcontainer. Immediatecurlreset was observed duringstartup. Parent then independently fetchedpublicHTTPShealth200/statusok/version0.1.0/uptime40 androot404application/json/NOT_FOUND. New API publiclyresponds andoldWebrootisretired. Final protectedsnapshot/liveledgercmp, privateworker-network verification and APK/credential/datafunctionalacceptance remain tofinish; no DBrollback was performed.


## Final production ledger comparison passed

Operator reported LEDGER_CHECK_OK from live-new-container db-manifest comparison against /opt/jizhang-backups/cutover-20261009T095502Z-2851966/final-snapshot-manifest.json. Live ledger table counts/digests match the final pre-cutover snapshot; no restore was performed. Parent public read-only API-retirement probe also passed at https://jz.yansuu1.xyz. API-only production is responding with preserved database. Pending operator CUTOUT_NETWORK_OK and physical APK login/data/new-entry/session acceptance; full source Web retirement still gated.
