# Item Image Segmentation: Integration Findings

## Supplied source

Source: `E:\.01study\Projects\agentProjects\拾物_自动分离_源码版` (source commit `09445676a597739beba64ce831cc81e88e02d263`).

- It segments visible physical objects from a photo into transparent PNGs; it does not OCR receipts or create bookkeeping entries.
- The local workbench uses Python 3.11, FastAPI, PyTorch, Ultralytics YOLOE/YOLO11, and SAM 2.1. Its model manifest totals 515,816,919 bytes (~492 MiB).
- The README allows 20 MB / 40 MP inputs, returns object names from model predictions, and stores generated PNGs and reports in a local `data/` folder with 24-hour cleanup.
- `local_app/server.py` trusts only localhost/test hosts, rejects cross-origin mutating requests, binds as a loopback workbench, queues inference in a single worker, and holds job state in process memory. It is not a drop-in remote inference API for the hosted HTTPS site.
- The package contains an AGPL-3.0 license. GNU's explanation says modified AGPL programs run on a server must offer corresponding source to users interacting over the network; exact obligations depend on whether/how the source is modified and combined. The model/runtime components also need their own license review before shipping.

## Existing application constraints

- Backend is one Fastify/SQLite service. Protected feature routes must be registered inside the existing authenticated plugin, and domain behavior belongs in services.
- SQLite schema changes are additive TypeScript migrations. Money is integer cents; time is epoch milliseconds.
- Current API body limit is 8 MiB and the server does not have a multipart dependency. Existing platform import can accept raw bytes or JSON/base64, but base64 expands media and is not an appropriate way to raise the image limit without a deliberate bounded upload design.
- Docker currently runs only the Node app, sets `NODE_OPTIONS=--max-old-space-size=256`, and publishes only loopback port 8081. The user clarified the new deployment target is 4 vCPU and 8 GiB RAM; host swap status is not confirmed. The heap cap is not the same as a whole-container memory cap, and model peak memory still requires profiling before the later segmentation phase.
- Current backups are consistent SQLite snapshots made with `VACUUM INTO`; they do not archive an external asset/media directory. Persistent item images therefore require a media backup and restore design, with a round-trip verification.
- Current app routes and data models contain transactions, accounts, categories, transfers, and assistant data, but no individual-item/asset entity.

## Viable rollout shapes

1. **Defer segmentation execution:** implement item CRUD, persistent photos, item metrics, and optional transaction links; define an image-segmentation adapter boundary so a later worker can plug in. This avoids destabilizing the current server while still delivering the inventory feature.
2. **Separate inference service:** run Python/model dependencies outside the Node container, with the authenticated Node API as the browser-facing boundary, bounded job concurrency, cleanup, timeouts, and progress reporting. This requires a resource profile and license decision before production enablement.
3. **User-local helper:** retain local-only inference on a Windows PC. This does not provide a reliable experience on the primary iPhone/browser or while the PC/helper is offline, and the current host/origin restrictions need a deliberate secure integration.

## References

- Source overview: `拾物_自动分离_源码版/README.md`
- Local API: `拾物_自动分离_源码版/local_app/server.py`
- Segmentation pipeline: `拾物_自动分离_源码版/local_app/pipeline.py`
- Model manifest: `拾物_自动分离_源码版/local_app/model-manifest.json`
- GNU AGPL explanation: https://www.gnu.org/licenses/why-affero-gpl.html
