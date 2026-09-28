# Item Image Cutout — Phase 2

## Goal

Let the user turn a photo selected while creating or editing an item into a transparent cutout, review the generated candidates, and save exactly one chosen result as that item's photo. Keep the experience private, bounded, and separate from bookkeeping writes.

## Confirmed Decisions

- The user approved a new Phase 2 Trellis task and chose automatic cutout first; visual recognition, labels, and category suggestions remain deferred.
- Prefer an independently implemented, license-compatible inference service. Do not copy or ship the supplied AGPL-3.0 application, Ultralytics code, or YOLO weights in this phase.
- SAM 2.1 automatic masks are the initial candidate, subject to a measured quality/resource gate and a full license audit of the exact checkpoint and runtime dependencies. Candidates are generic regions, not recognized objects.
- The 4-vCPU / 8-GiB production host is available. The current Node container is separately capped at 256 MiB; inference must have its own explicit CPU/memory limits.
- Each item currently stores one optional photo as an authenticated SQLite BLOB, capped at 2 MiB. The web utility accepts source images up to 20 MiB / 40 MP, resizes the longest edge to 1600 px, and produces a WebP no larger than 2 MiB.
- Existing item CRUD, image persistence, backup/restore, and ledger-isolation contracts remain unchanged.

## Proposed Scope

1. Add an “AI 自动抠图” action beside the ordinary photo upload in the item create/edit flow.
2. Submit the already bounded/compressed image to the authenticated Fastify API. The Node service proxies it to a new Python inference service reachable only over a private Docker network.
3. Use an Apache-2.0-compatible segmentation stack (SAM 2.1 automatic-mask generation is the benchmark candidate) to generate unlabeled region candidates. Show at most eight transparent previews; the user chooses one or falls back to the original photo.
4. Keep the original and generated candidates transient. Do not write anything to the item or ledger until the user accepts the item form. The chosen cutout replaces the existing one-photo field through the current item-photo API; no schema or backup changes are expected.
5. Expose useful queued / processing / ready / failed / cancelled states without inventing percentage progress. Provide retry and cancel; errors must leave the previous saved photo intact.
6. Limit the inference worker to one active job and one waiting job. Expire temporary files/results after ten minutes and clean stale jobs after cancellation, timeout, or service restart.

## Out of Scope

- Object names, visual recognition/classification, item category suggestions, or automatic selection without user review.
- The supplied AGPL-3.0 project, Ultralytics YOLOE/YOLO11 code or weights, and any dependency whose license has not been checked.
- External image-processing APIs, public inference endpoints, permanent input-image archives, receipt OCR, and any ledger writes.
- New database tables, changes to item-photo backup semantics, or changes to item accounting/holding calculations.

## Acceptance Criteria

- On mobile and desktop, a user can keep the current normal-upload path or request a cutout from an item draft without creating or changing a ledger transaction.
- The service returns a bounded set of valid transparent PNG candidates; the user can preview/select one, cancel, or keep the original. Only the selected photo is saved through the existing photo path.
- A failed, timed-out, cancelled, or restarted inference job leaves the current saved item/photo unchanged and presents a usable retry/fallback.
- Inference is only reachable through authenticated, CSRF-protected app routes; its container has no published host port and accepts no browser traffic directly.
- Input type, signature, pixel count, byte size, job count, runtime, output count, and output size are bounded. User image bytes and local paths are never logged.
- Temporary uploads, masks, and previews are removed on completion/cancellation and expire after a documented TTL; a service restart cannot lose any persisted item data.
- Only reviewed, compatible code/weights are shipped; required license notices are included. No AGPL/Ultralytics component is included in this phase.
- The service runs on the existing 4-vCPU / 8-GiB host within an initial 2-CPU / 3-GiB container cap. On at least 12 public/synthetic, non-personal images bounded to a 1600 px edge, warm p95 latency is at most 45 seconds and peak RSS stays below 2.5 GiB; record cold model-load time separately. If it OOMs or misses the gate, tune a smaller checkpoint/point grid and remeasure; if it still fails, stop rollout and report alternatives rather than raising the host limit.
- Lint, type-check, full tests, PWA build gates, authenticated route tests, mocked-service browser tests, and one target-host model smoke test pass. Existing item-photo backup/restore and ledger-invariance tests remain green.

## Operational Gates

- The exact checkpoint, dependency license inventory, job transport, temporary-data lifecycle, resource limits, and rollback sequence are specified in `design.md`.
- The measured quality/latency/RSS gate is a prerequisite to production enablement; a failed gate is reported, not bypassed by removing resource limits.
- This task covers code and verification only. Production deployment requires the user's separate explicit request.
