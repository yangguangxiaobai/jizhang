# Implementation Plan — Item Image Cutout

## Preconditions

- Do not run `task.py start`, edit product code, or launch inference until the user approves the final planning summary.
- Keep Phase 2 to automatic cutout only; names, semantic classification, and category suggestions remain deferred.
- Use the independently licensed SAM 2.1 path only if exact code/checkpoint/dependency licensing is verified. Never copy the supplied AGPL service or introduce Ultralytics/YOLO code or weights.
- Production deployment requires a separate user request after review.

## Ordered Work

1. **License and inference spike**
   - Pin a SAM 2.1 checkpoint and its official configuration; inventory runtime/transitive licenses and add required notices.
   - Implement a disposable local/target-host spike around `SAM2AutomaticMaskGenerator`, CPU-only, 1600 px input, 2 CPU / 3 GiB limits, one worker.
   - Run a small public/non-personal photo set; record cutout suitability, cold start, warm p50/p95, peak RSS, output count/size, and failure behavior.
   - Go/no-go: a typical warm image must complete within 45 seconds, peak RSS must stay under 2.5 GiB, and the service must remain below its 3 GiB cgroup cap. If not, tune a smaller checkpoint/point grid and remeasure; if still failing, stop and return with alternatives rather than deploying.

2. **Inference service**
   - Add a separate Python/FastAPI container and health/readiness endpoints; package the pinned model/checkpoint in its image so runtime inference has no internet dependency.
   - Add strict content/pixel/size validation, a single worker, one active + one waiting job cap, at most eight filtered masks, transient previews/output files, ten-minute TTL, cancellation, and startup cleanup.
   - Keep internal job ids opaque and model paths/errors/log payloads private. Add deterministic unit tests with a fake engine; do not load weights in normal CI.

3. **Fastify boundary**
   - Add optional `JIZHANG_ITEM_CUTOUT_SERVICE_URL` configuration; absent/unavailable means ordinary photo upload continues and cutout returns a stable service-unavailable response.
   - Add typed authenticated/CSRF-protected create/status/cancel/preview/download routes inside `authModule.extraRoutes`; use bounded image MIME parsing and typed proxy helpers.
   - Return no-store/nosniff headers; ensure the inference container cannot be reached through a published host port or a public Caddy route.
   - Unit/route-test auth, CSRF, body bounds, queue-full, service timeout/down, malformed output, preview content types, and stale job ids.

4. **Web draft flow**
   - Add typed request/status/candidate methods to `api/client.ts` and keep all calls behind that client.
   - Add the cutout action, explicit processing states, cancel/retry, candidate gallery, transparency preview, and “use this” selection to the existing item photo draft.
   - Compress a selected result using the existing `prepareItemPhoto` path. Persist only when the existing item form is saved; keep the previous saved photo and normal upload fallback intact.
   - Add mocked-service browser tests for success, no candidates, error/retry, cancel, existing photo preservation, and confirmation-before-save.

5. **Compose and operational controls**
   - Keep `jizhang` on its existing default network and loopback host port; add a dedicated internal network shared only by Jizhang and the inference container.
   - Apply measured `cpus`/`mem_limit`/`memswap_limit`, healthcheck/readiness, and a small ephemeral temp filesystem. Preserve the existing Node memory cap and named data volume.
   - Document model/checkpoint provenance, license notices, model update procedure, temporary-data lifecycle, capacity, monitoring, and rollback.

6. **Verification and handoff**
   - Run `pnpm -r run lint`, `pnpm -r run typecheck`, `pnpm -r run test`, `pnpm --filter @jizhang/web run build`, and `git diff --check`.
   - Run Python unit tests without model downloads; separately build the inference image and run the pinned-model smoke/benchmark with bounded resources.
   - Run served-browser tests with a mocked inference service and verify the real service endpoints only on the isolated test/target host.
   - Compare transaction counts, balances, budget output, and statistics before/after cutout preview and item-photo save; assert byte-for-byte equality of financial responses.
   - Verify selected photos survive the existing backup/restore workflow and all transient jobs/files expire.
   - Present the exact commit plan and ask before any production deployment.

## Expected Files

- Backend: `packages/server/src/config.ts`, `packages/server/src/app.ts`, item route/service modules, tests, and `.env.example`/operational documentation for the optional JIZHANG-prefixed service URL.
- New service: `packages/cutout/` (or equivalent documented Python package) with pinned dependencies, Dockerfile, license notices, job API, and tests.
- Deployment: root `docker-compose.yml`, `.dockerignore` only if required, and service runbook.
- Web: `packages/web/src/api/client.ts`, `ItemEditView.vue`, reusable cutout candidate component/util, and item/browser tests.
- Trellis: this task's research/design/PRD/implementation files.

## Explicitly Not Changing

- No accounting, transaction, budget, transfer, AI provider, item lifecycle calculation, or database schema behavior.
- No AGPL source/YOLO models, external image API, GPU requirement, public inference port, persistent job/media table, or permanent copy of the original input.
- No change to the six navigation tabs or unrelated existing uncommitted workspace files.

## Implementation Status (2026-09-28)

### Implemented

- Added the private FastAPI/SAM 2.1 CPU worker, bounded transient job registry, internal-only
  Compose network, tmpfs, resource caps, optional Fastify proxy, and item-form candidate flow.
- Kept selected candidates in the existing form draft; only the current item-photo API persists
  the chosen result after save. Ordinary photo upload and all ledger behavior remain intact.
- Added backend, worker, Chromium, and WebKit tests plus the private-worker runbook and updated
  the executable item-assets spec.

### Verified

- `pnpm -r run lint`, `pnpm -r run typecheck`, the full TypeScript test suite, and the web/PWA
  build gates pass. The generated CSS is 109.09 KiB, within the approved 112 KiB limit.
- All 645 TypeScript tests pass. Eight Python fake-engine/service tests pass. The three new
  browser journeys pass on both Chromium and WebKit iPhone viewports;
  `docker compose config --quiet` also passes.
- Docker `test` target built and passed all eight Python tests. The Compose runtime image built
  locally; its pinned SAM2 source and checkpoint SHA-256 were verified. On the isolated
  2-CPU/3-GiB container, 12 synthetic 1600px images measured warm p50 8.16s, p95 8.54s,
  and peak cgroup memory 1321.5 MiB. Full measurements are in
  `research/runtime-benchmark-20260928.md`.
- The authenticated Fastify proxy was also exercised against the real worker with an in-memory
  database: create/status/preview/PNG download/delete all succeeded and transaction count stayed
  zero. The integration container used a temporary loopback-only port and was removed.
- The local Docker Scout scan indexed 227 package entries. All 116 Debian packages have
  copyright files; SAM2, cctorch, PyTorch, and TorchVision license/notice files are present.

### Pending release gate

- The 120-second deadline marks a job failed but cannot preempt an in-flight PyTorch call; that
  call remains charged to the bounded worker slot until it returns. Restarting the cutout
  container is the documented recovery if a call never returns.
- Manually review the Debian package license clauses and bundled PyTorch NOTICE before public
  image redistribution. The wheel inventory and local SBOM findings are recorded in
  `packages/cutout/THIRD_PARTY_NOTICES.md`.
- The user's 4-vCPU/8-GiB server was not contacted. Its target-host smoke/deployment remains
  separate and requires explicit authorization; the local 2-CPU/3-GiB Linux-container gate has
  passed.
- This task remains `in_progress` until those local/isolated gates are completed. Nothing has
  been deployed or enabled on the production server; production deployment still requires a
  separate explicit request.


## Release preparation (2026-09-28)

The user explicitly authorized commit and deployment to their existing private server.
A pre-release review found and fixed two lifecycle races: timeout/DELETE must not release a
still-running inference slot, and a late candidate download must not restore a removed photo.
The worker now holds waiting work outside the executor queue; the editor guards all async
selection mutations with draft generation plus job identity. Regression tests cover both.

The release is a transfer to the same user's private host, not publication of a container
image to third parties. Upstream notices remain bundled. The outstanding full Debian/PyTorch
license-obligation review is retained as a gate before redistribution to other recipients;
this distinction is an operational scope statement, not legal clearance.

The current host was verified as VM-4-4-ubuntu, 4 vCPU / 7.5 GiB usable memory, with
jizhang:9f12089 healthy and the existing app capped at 256 MiB. Deployment must preserve
that cap, its 160 MiB V8 heap, existing .env, data volume, loopback port, and host reverse proxy.
Build/test the new worker and verify readiness before switching the main app. Keep the old
image/config and take a database snapshot before the switch. Record actual deployment
results separately; no earlier local result is evidence of production success.
