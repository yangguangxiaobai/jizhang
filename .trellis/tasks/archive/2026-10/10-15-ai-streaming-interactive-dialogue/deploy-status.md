# AI streaming interactive dialogue — authorized production deployment

Status: **DEPLOYED** (backend deployment complete; Android-track online action may now begin)
Phase: 5 — deployed & verified
Started (UTC): 2026-10-16T06:10Z · Deployed (UTC): 2026-10-16T06:19:10Z

## Authorization envelope (recorded, not expanded)
- User explicitly authorized: production deployment of the streaming backend + controlled real-provider verification, executed by the backend sub-agent under parent acceptance.
- Explicitly NOT allowed (and not done): model/secret/default-timeout changes, real ledger writes, whole-DB reset/restore, history deletion, `git stage`/`commit`, new infrastructure, nested sub-agents.
- Android/device work is a separate track; this file is backend-only and exclusive to this agent.

## Deployed artifact (authoritative)
| Item | Value |
|---|---|
| Source bundle | `artifacts/jizhang-api-source-20261016T061009Z.tar.gz` (101 allowlisted files) |
| Bundle SHA256 | `5c685032b8b2fcd4c6283e17cd53587de361bcaa77736e1f554fc52cd234fdd3` |
| New image tag | `jizhang:api-streaming-20261016T061009Z` |
| New image ID | `sha256:ea4e3691630b031df3651102ca4b1a0e064b4be3516895b130cafaea10ad21bc` |
| Replaced image | `jizhang:api-ai-chat-fix-20261015T063906Z` (`sha256:8648f391da31…`), preserved as `jizhang:rollback-deploy-streaming-20261016T061009Z` |
| API container | `jizhang` id `24063ae637567a876e2b62328bf48a82f73a336d986c97f4d339d7b09f19083f`, user `node` |
| StartedAt | `2026-10-16T06:19:02.601484456Z` |
| Port | `127.0.0.1:8081` loopback only (80/443 held by host Caddy, not this container) |
| Volume | `jizhang_jizhang-data:/data` (unchanged) |

### Runtime-affecting diff vs previous deployed bundle
7 changed + 5 new backend files: `app.ts`, `db/migrate.ts`, `routes/assistant.ts`, `services/ai-provider-service.ts`, `services/assistant-conversation-service.ts`, `services/assistant-orchestrator.ts`, `services/assistant-types.ts`; new `db/migrations/011-assistant-generations.ts`, `services/assistant-generation-{runner,service}.ts`, `services/assistant-stream-{tokenizer,types}.ts`.

## API readiness
- Container health `healthy`; public `https://jz.yansuu1.xyz/api/v1/health` → `{"status":"ok","version":"0.1.0","uptime":…}`.
- Domain root → `404` with `content-type: application/json` (API-only preserved).
- Streaming routes compiled in the running image (`/generations` registered; `assistant-stream-tokenizer.js` and `assistant-generation-service.js` present).
- SSE route auth guard verified: `GET /api/v1/assistant/conversations/verify-nonexistent/generations?limit=1` → `401` (no model work started).
- **Deployed-runtime streaming smoke (shipped code, scripted upstream — not a real provider call, no DB access):** `artifacts/deploy-streaming-20261016T061009Z-runtime-smoke.mjs` executed inside the running image via `docker exec` PASSED — `supportsAssistantStream` accepted the real production Chat config (`mode=chat-completions`, `method=POST`, `responsePath=choices[0].message.content`), the shipped `AiProviderStream` + incremental tokenizer decoded 16 chars into 2 incremental fragments (`firstFragment="你好，这是真实流式"`), and the exact message `你好，这是真实流式输出的第一段。` matched. Log: `artifacts/deploy-streaming-20261016T061009Z-runtime-smoke.log`.
- **No provider request and no ledger write** were performed by this deployment.

## Ledger / data invariant
- Pre-change live manifest: integrity `ok`, 20 tables, migrations 1–10.
- Post-change live manifest: integrity `ok`, 22 tables, migrations 1–11 (`11 = assistant-generations`).
- Added tables only: `assistant_generation_events`, `assistant_generations`.
- Changed tables limited to `{schema_migrations}` — every pre-existing business/ledger table hash is byte-identical before vs after. No table removed.
- Effective credential/AI key names (`JIZHANG_AI_ENCRYPTION_KEY`, `JIZHANG_PASSWORD_HASH`, AI keys) and `NODE_OPTIONS=--max-old-space-size=160` unchanged. No secret values were printed or exported.
- Dependency containers unchanged (same IDs + StartedAt): `caddy 1c193e276ec9…`, `jizhang-cutout 72b7d257007c…`, `komari d39ea46deede…`.

## Backup & rollback evidence (off-server)
- Consistent SQLite snapshot (CLI `backup`, not a live `.db` copy): `/opt/jizhang-backups/deploy-streaming-20261016T061009Z/database/jizhang-2026-10-16T06-13-09-441.db`, SHA256 `fdf32bef52fbe9352a3dd7e050c800808fd4f44c28b4ca9761860ea59b1f88bc`.
- Off-server identical copy: `artifacts/backups/deploy-streaming-20261016T061009Z/jizhang-2026-10-16T06-13-09-441.db` (SHA256 matches).
- Isolated migration rehearsal on that backup (`node artifacts/stream-migration-rehearsal/verify-backup-and-migrate-20261016T061009Z.mjs`, log `…log`): backup integrity `ok`, 19 existing tables unchanged, added exactly `assistant_generation_events` + `assistant_generations`, migrations 1–10 → 1–11, idempotent second run, integrity `ok`.
- Protected config + topology rollback evidence: `/opt/jizhang-backups/deploy-streaming-20261016T061009Z/` (`config/`, `old-image-id.txt`, `before/after-topology.json`, `before/after-manifest.json`, `before/after-migrations.json`, `before/after-env-keynames.json`, `verification.json`, `build.log`, `source-checksums.log`).
- Image rollback = revert `image.override.yml` to `jizhang:rollback-deploy-streaming-20261016T061009Z` + wrapper `config`/`up`. **No database restore over live writes.**

## Phase log
- [P0] SSH topology reachable via existing key `~/.ssh/jizhang_deploy` (ubuntu@jz.yansuu1.xyz), `sudo -n` OK.
- [P1] Built + verified source bundle (101 allowlisted files, no `.env`/DB/key member).
- [P1] Wrote `artifacts/deploy-streaming-20261016T061009Z-prepare.sh` + `.sha256` (`f24e92e0…`).
- [P2] Ran prepare: protected rollback config saved, consistent CLI backup pulled off-server, before-manifest/migrations captured. Log: `artifacts/deploy-streaming-20261016T061009Z-prepare.log`.
- [P3] Off-island backup integrity + isolated migration rehearsal passed.
- [P4] Built independent image tag `jizhang:api-streaming-20261016T061009Z` (`artifacts/deploy-streaming-20261016T061009Z-build.sh` + `.log`).
- [P5] Switched only `image.override.yml` + API container; before/after manifest, topology, env and auth checks all passed. Log: `artifacts/deploy-streaming-20261016T061009Z-switch.log`.

## Deployment scripts (this delivery)
- `artifacts/deploy-streaming-20261016T061009Z-prepare.sh` — sha256 `f24e92e0f1b48bbb0a53d47849a07a2b5e6e6c11fda19ffa80de6adf9c12247f`
- `artifacts/deploy-streaming-20261016T061009Z-build.sh` — sha256 `1720ef4a2438ef1727b031515d4de2d110d3e2985827fcb181011828f654b045`
- `artifacts/deploy-streaming-20261016T061009Z-switch.sh` — sha256 `0a29ce0e8c5be6c4a95616af8ce3b5c2c197f43a76cf906a6cfb73a4b4779914`

## Android-track handoff
Backend deployment is complete and verified as of `2026-10-16T06:19:10Z`. The API now serves the streaming generation/SSE routes with the additive migration applied; the ledger is unchanged. The Android track may proceed with online actions against this server.

## Open item (not part of this deployment)
Controlled **real-provider streaming verification** (real upstream model call) remains authorized-but-not-yet-executed; no provider request has been made and the earlier long-context 20s timeout is not proven fixed by this deployment.

---

# Patch deployment #2 — chained clarification fix (server-only)

Status: **DEPLOYED_PATCH** (image switched + verified; no schema/migration/ledger change)
Deploy ID: `20261016T083118Z` · Deployed (UTC): `2026-10-16T08:57:21Z`
Supersedes the *running image* of the deployment above; the section above is kept as the
record of deployment #1 and is not rewritten.

This deployment ships exactly one source change, the fix documented in
`research/chained-choice-fix.md`: a generation that consumes a clarification answer must be
born with its **own** `answered_option_id`/`answered_at` = NULL. Before the fix, every second
clarification hop was permanently stuck (`ASSISTANT_CHOICE_STALE` /「该追问已被回答。」), which
is the device defect recorded in `device-status.md` §1 缺陷 2.

## Deployment identity

| Item | Value |
|---|---|
| Source bundle | `artifacts/jizhang-api-source-20261016T083118Z.tar.gz` (101 allowlisted files) |
| Bundle SHA256 | `042baf4e9dff2bca3d3c33295c083b4bc24e552b060341a46c43e99d72b75127` |
| New image tag | `jizhang:api-chained-choice-20261016T083118Z` |
| New image ID | `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` |
| Replaced image | `jizhang:api-streaming-20261016T061009Z` (`sha256:ea4e3691630b…`), still present under its own tag **and** preserved as `jizhang:rollback-chained-choice-20261016T083118Z` |
| StartedAt (UTC) | `2026-10-16T08:57:13.935239781Z` |
| Port / user / volume | `127.0.0.1:8081` loopback only · container user `node` · `jizhang_jizhang-data:/data` (unchanged) |
| Migration | **none** — `schema_migrations` still `1..11`, byte-identical before vs after |

## Runtime-affecting diff vs the previously deployed bundle

The verified bundle was compared file-by-file against the bundle of deployment #1:
- **file list identical (101 files, 0 added, 0 removed)**;
- **exactly one file differs**: `packages/server/src/services/assistant-generation-service.ts`
  (`2952c9cc…` → `bb1e6691…`).
- Checked source trees for extra local `.ts`/`.mjs` (e.g. `packages/server/scripts/e2e-*.mjs`):
  **none are part of the server-source allowlist**, so no unrelated change could ride along.
  No other changed/untracked server file is inside `packages/server/src`.
- Evidence: full-tree compare performed against the extracted previous bundle; the only diff
  is the fix (comment block + `VALUES (…, NULL, NULL, NULL, NULL, …)` + removal of two now-dead
  bind arguments and two dead `resolveInput()` fields).

**Whole-image compiled-artifact diff (strongest form of the check).** Both images were opened
with a read-only entrypoint and every compiled file was hashed:
`find packages/server/dist packages/shared/dist -type f | xargs sha256sum` →
**241 files in each image, identical file list, and exactly two files differ**:
`services/assistant-generation-service.js` (`725a62b8…` → `60fc43e0…`) and its
`services/assistant-generation-service.js.map` (`f9e5b1b5…` → `975172f2…`), the latter only
because the source changed. No dependency, route, migration or shared dist file differs.
Log: `artifacts/chained-choice-deploy-20261016T083118Z-compiled-diff.log`.

## Pre-flight (prepare)

- Protected rollback config saved (`config/` incl. `.env`, all four compose/override files,
  `manage.sh`), consistent CLI backup pulled off-server, before manifest/migration captured.
  Log: `artifacts/chained-choice-deploy-20261016T083118Z-prepare.log`.
- The **first prepare attempt was refused by design**: the live-DB guard tripped because the
  historical `assistant_generations` table is no longer empty (10 rows). The guard was corrected
  to test the *live queue* (`status IN ('accepted','running')`) instead of total history, then
  re-run: `liveGenerations = 0`, historical rows 10, allowed.
- Live DB diagnostic captured **read-only** before the switch:
  `live=0`, statuses `{completed: 8, failed: 2}`, outcomes `{answer: 4, awaiting-choice: 4, null: 2}`,
  `awaitingUnanswered=0`, `awaitingAnswered=4`, and exactly **two** rows with the pre-fix "born
  answered" signature (`863a936c…`, `ccf489cb…`). These historical rows were **not repaired**
  (a data fix is out of scope and would be a write to verified-live data).
- Consistent snapshot: `jizhang-2026-10-16T08-53-39-283.db`, SHA256 `bc412bf0e3d2e74df9af20c5419eecb68c8294732655e08d08b10078b2220b70`.
- Off-server identical copy: `artifacts/backups/chained-choice-20261016T083118Z/` (SHA256 verified
  equal on both sides).

## Off-server integrity + isolated rehearsal

`artifacts/chained-choice-deploy-20261016T083118Z-rehearsal.mjs` on the pulled backup copy:
backup integrity `ok`; the **new** build's `initializeDatabase()` applied **0 migrations**
(`applied: []`, `alreadyApplied: 11`), added/removed/changed tables all empty — every
pre-existing table byte-identical; post-run integrity `ok`; the new build's compiled
generation service carries the NULL-answer signature. **REHEARSAL_PASS**.

## Build + pre-switch proof

- `artifacts/chained-choice-deploy-20261016T083118Z-build.sh` / `.log`: image built from the
  byte-verified bundle (independent tag, running container untouched).
- `docker run` of the new image with the semantic probe PASSED before the switch; the image's
  compiled `dist/services/assistant-generation-service.js` hash is `60fc43e0e0dfd3b5b43edc752a463f7bd33c6e30c266ded3c812b47e74476f6c`
  (identical to the local build output).

## Switch (log: `artifacts/chained-choice-deploy-20261016T083118Z-switch.log`)

Only `image.override.yml` was edited and only the API container recreated. **One mid-flight
defect and its fix must be recorded**: the first switch run failed at the compiled-signature
check («Compiled generation service does not carry the NULL-answer fix»), rolled the image back
automatically, and the log shows the container healthy on the old image again. Root cause was a
false negative in the *verification* step, not in the build: the check used `grep -q "…[]…"`
(basic regex, where `[]` is an empty bracket expression) and this image's `grep` supports `-F`
but not the `--` end-of-options marker. The check was rewritten to `grep -Fq --`, re-verified
locally against both the old and new compiled files (old → bug signature match / fix no-match;
new → fix match / bug no-match), and the switch was re-run successfully.

Verified after the (successful) switch:
- health `https://jz.yansuu1.xyz/api/v1/health` → `{"status":"ok",…}`; root `/` → `404` with
  `content-type: application/json` (API-only preserved).
- SSE generation route auth-guarded: `GET …/generations?limit=1` → `401` (no model work).
- Compiled streaming routes/tokenizer/generation service present; the running generation service
  carries the NULL-answer SQL and **does not** carry the old bug signature.
- **Semantic probe inside the running image** (throwaway `mkdtemp` DB + `initializeDatabase`,
  never `/data/jizhang.db`): `PASS` — new generation `answered_option_id=null, answered_at=null`;
  source row keeps `answered_option_id=o1`; provenance (`source_generation_id`, `question_id`,
  `input_json`) preserved; identical replay returns `created:false` with the same id; a second
  click on the consumed source is rejected `ASSISTANT_CHOICE_STALE`; ledger rows unchanged (0→0).
  The same probe run against the **old** image from inside the container `FAILED` with
  `answered_option_id="o1"` — the direct runtime proof of what the patch changed.
- Ledger/data invariant: manifest integrity `ok`; table set identical; **every** table hash
  byte-identical before vs after (`changedTables: []`, including `sessions`); migrations `1..11`
  unchanged; `assistant_generations`/`_events` row counts unchanged.
- Topology: `caddy`, `jizhang-cutout`, `komari` IDs + StartedAt unchanged; API `user=node`,
  mounts, networks, `127.0.0.1:8081` loopback unchanged; all protected config bytes unchanged
  except the intentional `image.override.yml` tag.
- Effective env: secret **key names** unchanged **and** every effective secret **value**
  compared by SHA256 in memory — `effectiveSecretValuesIdentical: true` for
  `JIZHANG_AI_ENCRYPTION_KEY`, `JIZHANG_PASSWORD_HASH`; `NODE_OPTIONS=--max-old-space-size=160`
  unchanged. Only booleans + key names were written; no value or value-hash left the host-side
  private backup dir.
- Rollback readiness: image rollback = restore `config/image.override.yml`
  (`jizhang:api-streaming-20261016T061009Z`, image ID `ea4e3691630b…`, ALSO tagged
  `jizhang:rollback-chained-choice-20261016T083118Z`) + `manage.sh config` / `up`.
  **No database restore, and none over live writes.**

## Contract / behaviour change visible to clients

None. Request/response shapes, status codes, error codes, the 4000-char input bound,
provider/model/timeout configuration, migrations, legacy endpoints and auth are untouched.
The only difference is that a freshly created generation no longer starts pre-answered; the
stale guard, the supersede UPDATE and the single-use-of-a-question rule are unchanged.

## Deployment scripts (this delivery)

- `artifacts/chained-choice-deploy-20261016T083118Z-prepare.sh` — sha256 `4402190f590214bf915bf54729d2d09305beccf315ed701997604297c3281e35`
- `artifacts/chained-choice-deploy-20261016T083118Z-build.sh` — sha256 `7085e4260c5b023adb4f5c21b9efa1779177286de836549a90495c2484b04d17`
- `artifacts/chained-choice-deploy-20261016T083118Z-switch.sh` — sha256 `3247f02990c08c5e548360826dfcc5ae7a6722a1d38146c05cccd44b3734f2e5`
- `artifacts/chained-choice-deploy-20261016T083118Z-semantic-probe.mjs` — sha256 `9c52a943e6bccd8b119d759faefdda97269b6a96b0292bcaa984bb0f30cb5855`

(Server-side copies under `/opt/jizhang-upload/` have the same switch-script hash; the local
`.sha256` sidecars of the three scripts and both `.mjs` helpers match the delivered bytes.)

## Android-track handoff

Server is running the fixed build as of `2026-10-16T08:57:21Z` (UTC). See
`artifacts/DEPLOYED_PATCH-chained-choice-20261016T083118Z.md` for the phone-verifier handoff
requirements.

## Still open (unchanged from deployment #1)

Controlled real-provider streaming verification remains authorized-but-not-executed; this
deployment made no provider call and wrote no ledger row.
