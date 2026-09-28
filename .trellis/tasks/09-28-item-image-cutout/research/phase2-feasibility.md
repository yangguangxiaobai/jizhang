# Phase 2 Feasibility Findings

## Product and current application

- The user approved Phase 2 as automatic item-photo cutout first; visual recognition, object names, and category suggestions remain deferred.
- `ItemEditView.vue` currently keeps a selected, compressed photo in the draft and writes it only after the user saves. Reuse that draft/commit boundary: segmentation must not create or update an item by itself.
- `prepareItemPhoto()` accepts JPEG/PNG/WebP source files up to 20 MiB / 40 MP, scales the longest edge to 1600 px, and returns a WebP no larger than 2 MiB. The Fastify body limit is 8 MiB and has raw image parsers.
- `ItemService` accepts JPEG/PNG/WebP photos up to 2 MiB and stores them as SQLite BLOBs. Existing `VACUUM INTO` backups therefore include only the final selected image without adding another media-archive format.
- The existing Jizhang container publishes only 127.0.0.1:8081 and is capped at 256 MiB. On 2026-09-28 the host reported 4 vCPU, 7.5 GiB RAM, 6.6 GiB available, and 2 GiB swap. Inference must use a separate bounded container; do not raise the Node container's cap as a shortcut.

## Supplied implementation and license boundary

The supplied `拾物_自动分离_源码版` is not a drop-in library. Its current pipeline uses Ultralytics YOLOE/YOLO11 to detect and label objects, then SAM 2.1 to refine masks. Its model manifest totals 515,816,919 bytes (~492 MiB). The folder contains an AGPL-3.0 LICENSE; the README says the Ultralytics code/models follow upstream terms. Ultralytics describes its YOLO code/models as AGPL-3.0 or enterprise-licensed. This Phase 2 therefore must not copy or ship that application, YOLO package, or YOLO weights.

The independent model candidate is SAM 2.1 from Meta's official repository. The repository states that its code and checkpoints are Apache-2.0 licensed and exposes `SAM2AutomaticMaskGenerator` for whole-image mask proposals. Those proposals are regions, not semantic object identities; the UI must let the user review/select a candidate. The SAM 2.1 checkpoint, PyTorch/TorchVision and every runtime dependency still need an exact version/license inventory before the image is shipped.

## Deployment shape

- Keep Fastify as the only browser-facing API. Add authenticated/CSRF-guarded item cutout routes there; it calls a private Python inference service over a dedicated internal Docker network.
- The inference container has no published host port and no outbound runtime access. Bake the audited checkpoint into its image or a deliberately managed model layer; do not download weights in response to user requests.
- Keep the ordinary item-photo flow available if the service is not configured, unhealthy, or rejects a job.
- Store upload, masks, previews, and job state only in bounded transient memory/container temp storage. Persist only the user's accepted cutout through the existing item-photo endpoint/SQLite BLOB.
- Suggested initial resource envelope: 2 CPU cores and a 3 GiB memory cap for the inference container, one active job, at most one waiting job, an 8-candidate result cap, and a 10-minute result TTL. Validate/tune this with target-host profiling before enabling production traffic.

## Primary sources

- [GNU AGPL-3.0 §13](https://www.gnu.org/licenses/agpl-3.0.en.html) — network interaction source provision for modified covered programs.
- [Ultralytics licensing / contribution guide](https://docs.ultralytics.com/help/contributing/) — upstream description of AGPL-3.0 use and enterprise licensing.
- [Meta SAM 2 repository](https://github.com/facebookresearch/sam2) — Apache-2.0 code/checkpoint statement and automatic-mask-generation example.
- [SAM2AutomaticMaskGenerator implementation](https://github.com/facebookresearch/sam2/blob/main/sam2/automatic_mask_generator.py) — whole-image mask generation and quality/duplicate filters.
- Local source: `E:\.01study\Projects\agentProjects\拾物_自动分离_源码版\LICENSE`, `README.md`, `local_app\pipeline.py`, and `local_app\model-manifest.json`.
