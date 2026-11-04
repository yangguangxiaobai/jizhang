# Deployment acceptance review — AI streaming (independent verification)

Status: **COMPLETE — overall PASS (documentation PASS / runtime PASS, with declared evidence gaps)**
Reviewer scope: independent verification only. No rebuild, no restart, no config change, no provider call, no ledger write, no stage/commit, no nested sub-agents, no source edits.
Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
Deployed artifact under review: `jizhang:api-streaming-20261016T061009Z` (`sha256:ea4e3691630b031df3651102ca4b1a0e064b4be3516895b130cafaea10ad21bc`)
Deployment self-reported at `2026-10-16T06:19:10Z`; re-verified at `2026-10-16T06:37Z` (server clock).

## 1. Verdict summary

| # | Acceptance check | Verdict | Basis |
|---|---|---|---|
| 1 | Local bundle SHA256 matches sidecar | **PASS** | `artifacts/deployment-acceptance-bundle.log` |
| 2 | 101-file allowlist, no `.env`/DB/keys | **PASS** | bundle log (`.env.example` template only, no real secret lines) |
| 3 | Server-side 101-file checksum verification | **PASS** | `source-checksums.log` 101×OK, 0 failures |
| 4 | Pre/post manifest: only `schema_migrations` + 2 new tables | **PASS** | server `before/after-manifest.json` recomputed |
| 5 | Backup hash matches + integrity ok | **PASS** | local + server SHA256 and `PRAGMA integrity_check` |
| 6 | Fresh migration rehearsal reproduces expected state | **PASS** | rehearsal DB → 22 tables, migrations 1–11 |
| 7 | Env equality (effective key names + `NODE_OPTIONS`) | **PASS** | `before/after-env-keynames.json`; no values printed |
| 8 | Topology/dependency containers unchanged | **PASS** | `before/after-topology.json` recomputed; live IDs equal |
| 9 | Loopback-only + non-root API container | **PASS** | `ss` + `docker inspect` live probe |
| 10 | HTTPS health 200 / domain root 404 JSON | **PASS** | live `curl` through host Caddy |
| 11 | SSE generation route present and auth-guarded | **PASS** | live `401` + compiled route/tokenizer presence |
| 12 | Deployed-runtime streaming smoke | **PARTIAL** | PASS but **scripted upstream, not a real provider** |
| 13 | Controlled **real-provider** streaming verification | **BLOCKED (by design)** | Not executed; owned by the real-device track |

Overall: the *backend deployment* acceptance criteria are satisfied. The one deliberately open item (`deploy-status.md` “Open item”) — a controlled real-provider stream — remains untested and is explicitly **not** claimed here.

## 2. Scope discipline
- Read-only SSH to `ubuntu@jz.yansuu1.xyz` using the existing key `~/.ssh/jizhang_deploy`; `sudo -n` read/inspect/`docker inspect`/`docker exec` (read-only) only.
- No `docker compose up`, no image rebuild, no container restart/recreate, no `.env`/config change, no `git stage`/`commit`, no DB restore, no ledger write.
- No secret values, cookies, or env values printed — only secret *key names* and non-secret `NODE_OPTIONS`.
- Only files written: this report and `artifacts/deployment-acceptance-{bundle,backup,runtime,serverstate,health}.log`.

## 3. Detailed findings

### 3.1 Source bundle and allowlist — PASS
- Local `sha256(artifacts/jizhang-api-source-20261016T061009Z.tar.gz)` = `5c685032b8b2fcd4c6283e17cd53587de361bcaa77736e1f554fc52cd234fdd3`, identical to the sidecar and to `deploy-status.md`. 102 archive members = `SHA256SUMS` + 101 files; every file digest matches the embedded manifest; all members are under the `jizhang-api-source/` prefix with no links or `..` traversal.
- Forbidden-content scan: **no member** ending in `.env` (only the committed **`.env.example` template**, 5195 bytes, 0 lines matching `sk-`/`AKIA`/`PRIVATE KEY`/`ghp_`/JWT patterns), **no** `.db`/`.sqlite`, **no** `.pem`/`.key`/`.p12`/keystore/`id_rsa`.
- The 7 runtime-affecting backend files and the new `011-assistant-generations.ts` migration are all present in the bundle, consistent with `deploy-status.md`.
- Server-side: `source-checksums.log` shows **101 `: OK`, 0 non-OK lines**; the builder’s `create-source-bundle.py --verify` (which independently re-checks the allowlist and digests) passed during build.

### 3.2 Ledger / data invariant — PASS
- Recomputed the server `before/after-manifest.json`: integrity `ok → ok`, tables `20 → 22`, **added** exactly `['assistant_generation_events','assistant_generations']`, **removed** `[]`, **changed** exactly `['schema_migrations']`. No pre-existing business/ledger table hash changed.
- Server `verification.json` independently agrees (`changedTables: ["schema_migrations"]`, `migrationsAfter: [1..11]`).
- **Nuance (documented, not a defect):** the offline pre-change backup (correctly) has 20 tables and migrations 1–10 — it predates migration 011 — while the live pre-manifest in `deploy-status.md` reports 21 tables/migration 1–10. The offline rehearsal confirms the exact transition 20→22 on the backup. This is consistent; no data drift.
- `PRAGMA integrity_check = ok` on: the off-server backup, the fresh rehearsal DB, and the live manifests.

### 3.3 Backup — PASS
| Artifact | Value | Verified |
|---|---|---|
| Server snapshot | `/opt/jizhang-backups/deploy-streaming-20261016T061009Z/database/jizhang-2026-10-16T06-13-09-441.db` | present, `-rw------- root`, 704512 B |
| Off-server copy | `artifacts/backups/deploy-streaming-20261016T061009Z/jizhang-2026-10-16T06-13-09-441.db` | present |
| SHA256 (both) | `fdf32bef52fbe9352a3dd7e050c800808fd4f44c28b4ca9761860ea59b1f88bc` | **matches** sidecar, server, and off-server |
| Integrity | `ok` | `PRAGMA integrity_check` |
- Rollback image tag `jizhang:rollback-deploy-streaming-20261016T061009Z` = `8648f391da31…`, matching recorded old image id.
- Isolated rehearsal (`verify-backup-and-migrate-20261016T061009Z.*`) on that backup: integrity `ok`, pre-migrations 1–10 (20 tables), post 1–11 (22 tables), **19/19 pre-existing tables unchanged**, second run idempotent, integrity `ok` — independently reproduced from the rehearsal DB.

### 3.4 Runtime environment equality — PASS
- Server `before-env-keynames.json` = `after-env-keynames.json`: `secretKeyNames = ["JIZHANG_AI_ENCRYPTION_KEY","JIZHANG_PASSWORD_HASH"]`, `nodeOptions = --max-old-space-size=160`.
- Live `docker inspect jizhang` now yields the **same** key names and the same `NODE_OPTIONS` — equal across before/after, and consistent with `deploy-status.md`. No secret values were read or printed.

### 3.5 Topology / dependencies — PASS
- Recomputed diff of `before/after-topology.json`: `caddy`, `jizhang-cutout`, `komari` entries are **identical**; for `jizhang` the `user`, `mounts`, `networks`, `ports` fields are equal (only the container id and image changed, as expected for an image swap).
- Live `docker inspect` IDs and `StartedAt` match the recorder exactly: `caddy 1c193e27…` since `2026-10-09T03:51Z`, `jizhang-cutout 72b7d257…` since `2026-09-28T11:43Z`, `komari d39ea46d…` since `2026-09-24T05:42Z`. No dependency container restarted.
- `config-hashes.json` comparison (excluding the intentionally switched `image.override.yml`) is the deployment script’s own guard; the .env/compose/override `docker compose config` validation passed in-build.

### 3.6 Loopback / non-root / network exposure — PASS
- `sudo ss -lntp`: `127.0.0.1:8081` (docker-proxy) only; `:80` and `:443` are held by the **host** `caddy` (pid caddy), not the API container. API is not reachable off-loopback directly.
- `docker inspect jizhang`: `Config.User = node`, port binding `{"8081/tcp":[{"HostIp":"127.0.0.1","HostPort":"8081"}]}`, volume `jizhang_jizhang-data => /data`, networks `jizhang_cutout-internal`, `jizhang_default`.
- `StartedAt = 2026-10-16T06:19:02.601484456Z`, `RestartCount = 0` — no crash-restart loop.

### 3.7 HTTPS health / root 404 / auth guard — PASS
- `GET https://jz.yansuu1.xyz/api/v1/health` → `200`, `content-type: application/json`, body `{"status":"ok","version":"0.1.0","uptime":1149}`.
- `GET https://jz.yansuu1.xyz/` → `404`, `content-type: application/json`, body `{"error":{"code":"NOT_FOUND","message":"Route GET / not found"}}` (API-only surface preserved).
- Host Caddy fronts the API via `jz.yansuu1.xyz { reverse_proxy 127.0.0.1:8081 }`.
- `GET http://127.0.0.1:8081/api/v1/assistant/conversations/verify-nonexistent/generations?limit=1` → `401` (SSE generation route registered and auth-guarded; no model work started).
- Inside the running image: `routes/assistant.js` contains `/generations`; `assistant-stream-tokenizer.js`, `assistant-generation-service.js`, `assistant-generation-runner.js` are present.

### 3.8 Streaming smoke — PARTIAL (mock, not real provider)
- `artifacts/deploy-streaming-20261016T061009Z-runtime-smoke.{mjs,log}` ran the **shipped** `AiProviderStream` + incremental tokenizer inside the production image against a **scripted in-process SSE `ReadableStream`** (synthetic Chinese text, no network, no DB). Result: `runtimeStreamingSmoke: PASS`, `supportsProductionChatConfig: true`, 2 incremental fragments, 16 decoded chars, exact message match.
- This is valid evidence that the deployed image contains working incremental Chat-stream decoding. It is **not** evidence of a real model call. Container logs contain no provider/upstream activity, consistent with no provider request having been made.
- **Evidence gap:** controlled **real-provider** streaming verification remains unexecuted; per `deploy-status.md` and `prd.md` it is authorized but intentionally deferred, and the earlier long-context ~20s timeout is **not** proven fixed. Real end-to-end provider streaming is owned by the real-device track (`device-status.md` currently `BLOCKED_DEVICE` — no host-attached device).

## 4. Discrepancies / caveats found (non-blocking)
1. **Table-count nuance (3.2):** live pre-manifest = 21 tables/1–10 vs offline backup = 20 tables/1–10. Explained by migration ordering; no drift.
2. **`scripts/sourcebundle.sha256` does not exist in this repository.** The requested equivalent evidence is (a) the bundle sidecar `artifacts/jizhang-api-source-20261016T061009Z.tar.gz.sha256` = `5c685032…` and (b) the in-archive `SHA256SUMS` manifest (101 entries, all matching). Verification used those instead; no file was created to satisfy a path that does not exist.
3. **Smoke vs real provider** clearly separated (3.8). No mock result is reported as provider acceptance.

## 5. Evidence artifacts (this review)
- `artifacts/deployment-acceptance-bundle.log` — local hash, 101-file allowlist, forbidden-member scan, template check
- `artifacts/deployment-acceptance-backup.log` — backup hash/integrity/migrations + rehearsal DB recheck
- `artifacts/deployment-acceptance-runtime.log` — live container identity, env key names, topology, compiled-route probe
- `artifacts/deployment-acceptance-serverstate.log` — server manifest diff, env-keynames equality, verification.json, backup/deps
- `artifacts/deployment-acceptance-health.log` — HTTPS health, root 404, unauth 401, loopback/listener, Caddyfile

## 6. Bottom line
**PASS** for the backend deployment acceptance envelope: reproducible source bundle, secret-free allowlist, additive-only schema change, intact/changed-table-safe ledger, verified + rehearsed backup, unchanged runtime env and topology, loopback-only non-root container, healthy HTTPS API with API-only 404 surface and auth-guarded SSE route.
**PARTIAL** for streaming realism: deployed-runtime streaming works against a scripted upstream only.
**BLOCKED (intentional)** for controlled real-provider streaming and on-device acceptance: not executed here; assigned to the real-device track.
