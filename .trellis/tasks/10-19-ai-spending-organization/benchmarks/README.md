# Synthetic capacity check — AI organization (not a calibration)

Date: 2026-10-19. Run via `node .trellis/tasks/10-19-ai-spending-organization/benchmarks/organization-capacity-synthetic.mjs`.

## Method

The harness constructs synthetic transaction-like payloads only (bounded 160-character notes, two tags, IDs/category metadata), JSON-measures request and response bytes, executes sequential batches of proposed size 25, and injects an 8 ms mock delay per call. It has no network, provider SDK, database, export, secrets, or production data. The observed machine's process heap/RSS deltas and timings are recorded per case in `organization-capacity-synthetic-results.json`. Failure injection outputs are `failure-batch-1.json` and `failure-batch-2.json`.

Counts exercised: 1, 24, 25, 26, 200, 499, 500, 501. This includes the 25-batch edge, first multi-batch row, proposed-cap boundary and first over-cap row.

## Observations

- Successful accepted runs had complete coverage and published a mock card only when `processed === eligible`.
- At 25: 1 call; 26: 2 calls; 200: 8; 499 and 500: 20 sequential calls.
- At 500, maximum synthetic serialized request batch was about 9.3 KB; aggregate request bytes about 185 KB; maximum mock response batch about 1.7 KB; aggregate response about 34.3 KB. These values describe only this fabricated schema/record distribution.
- At 501, harness rejected before mock calls (`providerCalls=0`, no card), matching the proposed no-truncation behavior. The 500 threshold remains provisional and not user-approved.
- Injected failure at batch 1 (case 1) produced failed/no-card/zero processed. Injected failure at batch 2 (case 26) produced failed/no-card despite 25 earlier rows being processed; no partial actionable output. Failure JSON covers each accepted size where the injected batch exists.
- Local measured elapsed times under this mock range from roughly 15 ms for one batch to roughly 307 ms for 20. Despite configured 8 ms mock sleep/call, scheduler and serialization overhead is included. This is not a provider latency, API deadline or user-perceived latency estimate.
- Heap/RSS deltas are process-local noisy deltas, not peak memory. The harness does not model the server's 160 MiB production heap, provider transport buffers, DB snapshots, concurrent requests, model prompt expansion, retries, or runtime timeout/cancellation behavior. It cannot establish safety at 500 rows.

## Conclusion

This demonstrates only deterministic harness behavior for representative bounded JSON shapes: chunk boundaries, sequential call count, full-coverage success, over-cap refusal and no-card-on-failure. It does **not** prove provider acceptance, actual payload equivalence, memory peak, acceptable latency, timeout behavior, or production capacity. Therefore 500/25 remain proposed; explicit parent/user review is still required before those numbers become a product/API cap. No real export/provider was used or claimed.
