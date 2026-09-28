# Technical Design — Private Item-Photo Cutout

## Boundary

The feature adds candidate generation to the existing item-photo draft flow. It does not alter item records, the SQLite schema, current photo persistence, transaction links, account balances, budgets, or statistics. Visual labels/recognition remain out of scope.

## Architecture and trust boundaries

```text
ItemEditView (prepared WebP, <= 2 MiB)
  -> typed same-origin API client
  -> authenticated Fastify route (session + CSRF)
  -> private Docker network / bounded Python cutout service
  -> transient job + masks + previews
  <- status and candidate metadata / authenticated preview and selected PNG
  -> existing prepareItemPhoto + item-photo API
  -> asset_item_photos SQLite BLOB (only after user saves the draft)
```

- Fastify is the only public/browser-facing API. All new mutating routes are registered through `authModule.extraRoutes`, so the existing auth and CSRF hooks cover them.
- The Python service has no host-published port and does not receive browser cookies. It runs only on a dedicated `internal: true` Docker network shared with `jizhang`; the Node service retains its existing default network for provider calls and its loopback-only port binding.
- Use the official SAM 2.1 automatic mask generator as the initial Apache-2.0 model candidate. Do not import the supplied AGPL application, Ultralytics, YOLO code, or YOLO checkpoints. Pin and audit exact package/checkpoint versions and include their notices.
- The inference service emits generic regions, not names or categories. Rank/filter proposals by mask quality, size, and overlap, then show at most eight unlabeled candidates for user review. A candidate gallery is essential because automatic masks can contain parts, whole scenes, or background; the model cannot know which item the user intends to keep.

## API contract proposal

The public API is mounted inside the authenticated item route module:

- `POST /api/v1/items/cutouts` — accept raw `image/webp` bytes prepared by `prepareItemPhoto`; return `202 { jobId }`.
- `GET /api/v1/items/cutouts/:jobId` — return `queued | running | ready | failed | cancelled`, a user-facing status message, and candidate metadata when ready. Do not invent a percentage; report real coarse stages only.
- `GET /api/v1/items/cutouts/:jobId/candidates/:candidateId/preview` — return a bounded transparent thumbnail as `image/webp`.
- `GET /api/v1/items/cutouts/:jobId/candidates/:candidateId/image` — return the chosen full-size transparent PNG; the web client reuses `prepareItemPhoto` to compress it to the existing 2 MiB WebP limit.
- `DELETE /api/v1/items/cutouts/:jobId` — cancel queued work or clear completed transient results.

All API responses use `Cache-Control: no-store`; image responses also set `X-Content-Type-Options: nosniff`. Job ids are random and short-lived. Node validates route parameters and maps service timeouts/unavailable states into stable app errors without exposing service paths, traces, or model details.

The private inference API mirrors create/status/cancel/candidate operations but is never exposed to the host. It does not authenticate users itself; network isolation plus the authenticated Node proxy is the only ingress path.

## Job lifecycle and resource limits

- Keep one active inference job and at most one queued job. A full queue returns a stable busy response; no unbounded executor queue.
- Use a single CPU worker. Initial Compose targets are 2 CPUs and a 3 GiB memory limit with swap capped to the same limit; verify on the 4-vCPU/8-GiB host before release. Keep the Node container's existing 256 MiB cap unchanged.
- Reuse the existing client normalization: actual image signature, JPEG/PNG/WebP only, <= 40 MP source, longest edge 1600 px, compressed WebP <= 2 MiB. The Node body limit remains 8 MiB; no 20 MiB raw upload or global limit increase is needed.
- Bound generation to one 1600 px image, an initial 8-candidate output cap, bounded preview dimensions, and one chosen full-size result. Tune SAM2 point density / batch size during a CPU benchmark; do not raise the host or Node limits to hide an OOM.
- Store source image, RLE masks, and output candidates only under a dedicated container-temp directory. Do not mount that directory to a host path or database. Delete job files after selection/cancel and sweep any stale job directories at startup; expire jobs after ten minutes.
- Service restart may invalidate in-progress jobs, but no item data has been written yet. Return a clear retry state; the ordinary photo and saved item remain intact.
- Readiness should report model loaded. Jizhang startup and health must not depend on inference readiness; ordinary CRUD/manual photo upload must continue if the cutout service is down.

## Frontend interaction

- Keep the existing photo picker and preview. Add a separate “AI 自动抠图” action once a photo draft exists.
- Show queued/processing/error/cancelled states and a candidate gallery with a checkerboard transparency backdrop, generic candidate numbers, and a clear “使用这张” action. Never imply a candidate is semantically recognized.
- A successful selection updates only `preparedPhoto` and its preview URL. The user still submits the ordinary item form to save. For an existing item, the stored photo remains untouched until that save completes.
- Keep the original draft available as a fallback; allow retry, cancel, and return to ordinary upload. If no useful masks are found, show that clearly and preserve the original photo.
- On the final save, upload only the selected/compressed transparent image through the existing photo route. Never persist the original plus all candidates or create a ledger row.

## Compatibility and rollback

- No database migration or backup-format change: the chosen result uses the existing `asset_item_photos` BLOB, so `VACUUM INTO` backups continue to cover it.
- No service/Caddy public port, no public model API, and no runtime download of weights. The optional `JIZHANG_ITEM_CUTOUT_SERVICE_URL` is supplied by Compose; without it the feature is disabled with a useful message and ordinary photo upload remains available.
- Rollback removes the cutout API/UI/config and inference service, then restores the prior Compose image/config. There is no down migration; existing item rows and photos remain compatible because the selected output is already a supported WebP/PNG photo.
- Production deployment is not part of this planning task and needs a separate explicit request after implementation review.
