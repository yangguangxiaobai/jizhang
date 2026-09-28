# Local SAM 2.1 Runtime Benchmark — 2026-09-28

## Environment

- Local Docker Desktop Linux engine, `linux/amd64`.
- Benchmarked image: `jizhang-cutout:local`, ID `sha256:4ee8fc4971f3dfdc72acf7fcaaf5325887ffcd10618088a18a793bbd8fc79033`, size 485,952,622 bytes.
- The Compose runtime target was rebuilt after the notice inventory was finalized. Current
  `jizhang-cutout:latest` ID is
  `sha256:0d02f72fb8583ad35e6adf329d1eb8f14f414c16fcd22d1e59f3e7b920c454f6` (485,950,963
  bytes); the runtime code/model/dependency set is unchanged and the updated notice file is
  included.
- SAM 2.1 Hiera Small checkpoint SHA-256: `6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`.
- Temporary benchmark container: no network, no published ports, 2 CPUs, 3 GiB memory, swap capped at 3 GiB, 512 MiB job tmpfs. The container was stopped and auto-removed after the run.
- Cold startup: 2.78 seconds from container `StartedAt` to Uvicorn application startup complete.

## Workload and measurements

- Twelve deterministic synthetic images, each 1600×1000, WebP-encoded at quality 88. No personal or downloaded images were used.
- Images were posted serially through the actual worker HTTP API; each completed job was deleted before the next run.
- Warm latency, from request submission to `ready`, seconds: `8.54, 8.16, 8.20, 8.15, 8.17, 8.53, 7.80, 8.16, 7.79, 8.16, 7.80, 8.16`.
- Warm p50: **8.16 seconds**. Conservative nearest-rank p95 (the slowest of 12): **8.54 seconds**.
- Peak cgroup memory across startup and all 12 runs: **1321.5 MiB**.
- Candidate count per image: `8, 5, 8, 7, 8, 6, 7, 7, 8, 7, 7, 7`.
- A real model candidate was returned as transparent PNG; one synthetic sample had alpha range `0–255`, 25.1% fully transparent pixels, and 1.1% antialiased edge pixels.

## Fastify-to-worker smoke

- A temporary in-memory Fastify app used a session and CSRF header to call the real worker at
  a loopback-only port. A synthetic 8,684-byte WebP produced three candidates; the proxied
  preview was 14,296-byte WebP and the selected candidate was a 23,333-byte PNG with a valid
  PNG signature. All responses had the expected no-store/type headers.
- The isolated ledger still had zero transactions, and deleting the job returned `204`. The
  localhost-only worker container was stopped and auto-removed afterwards.

## Result and limits

- Performance gates pass: p95 ≤45 seconds and peak worker memory <2.5 GiB, under the 3 GiB cgroup limit.
- This measures bounded CPU performance and alpha output on synthetic scenes; it does not establish real-world semantic accuracy. SAM 2.1 proposes generic masks, so the UI must keep manual candidate review and explicit save.
- The runtime Python distribution/version/license list is recorded in `packages/cutout/THIRD_PARTY_NOTICES.md`. A complete image-level audit of Debian base packages and bundled PyTorch notices remains before production release.
- No production server was contacted or changed.
