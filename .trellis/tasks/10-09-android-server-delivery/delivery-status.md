# Delivery status — 2026-10-09

## Confirmed operator decisions

- Final domain: `jz.yansuu1.xyz`.
- Server: Ubuntu, no SSH access supplied.
- Existing Caddy runs in Docker with host networking. Use `127.0.0.1:8081`
  and no Caddy shared-network overlay. Existing data volume is
  `jizhang_jizhang-data`; project directory `/opt/jizhang`; config mount
  `/opt/caddy/etc` -> `/etc/caddy` (active file still needs confirmation).
- Public Web serving stops first. Source stays temporarily for Android comparison,
  then is removed after complete Android acceptance and preserved test contracts.

## Local implementation and evidence

- API-only Fastify: root/former Web paths return JSON 404; obsolete static settings
  cannot re-enable Web. Server/shared checks passed (478 + 174 tests), including
  stale-file regressions; root build excludes Web.
- Android: version 0.1.0 / code 3; 11 JVM tests, debug/release compilation, build
  and lint passed. Core runtime, session expiry, CSV round trip and several new
  management workflows tested on Android 15; see the Android child's research.
- Deployment: Compose base and four overlay combinations validated with the
  official standalone CLI. Existing-volume/bind parameters reject missing values.
  Backup manifest tests and source-bundle safety tests passed (two each).
- Upload source archive contains 105 allowlisted files and per-file checksums;
  no Web/native clients, real env, data, signing material or repository metadata.
- Deliverables: `artifacts/jizhang-android-0.1.0-v3.apk`,
  `artifacts/jizhang-api-source-2026-10-09.tar.gz` and its SHA256 sidecar.
  The archive is source, not a built Docker image.

## Live observations and remaining work

Read-only public health at the final domain returns 200 / status ok. Root returns
200 HTML, so the old Web image is still deployed. No server changes were made.

Pending: actual old mount/project/environment discovery, tested image build/run,
verified production backup/restore drill, Caddy network/config validation and reload,
HTTPS APK login with preserved ledger data, full feature replay, physical HarmonyOS 4
and release-key continuity. Operator Docker inventory requested without secrets.

All delivery tasks remain in progress. Stage 2 Web source removal is not yet
authorized by the acceptance gate. Do not archive the tasks or mark remote deployment
complete based on repository changes, compilation or Compose model validation.


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
