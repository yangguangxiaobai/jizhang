# Timeout checkpoint recovery — 2026-10-23

## User evidence and uncertainty

User screenshot: 65 eligible rows, batch 1/3 completed25, batch2 waiting Provider failed AI_PROVIDER_TIMEOUT after total37s. This confirms a provider-call timeout while real progress works, not a repeated five-array response-contract error. It does not identify upstream network versus model latency or prove37s per-call timeout. No live Provider or production database was accessed in this follow-up.

## Smallest behavior gap and ownership

Existing fixed25-row whole-response calls fail the whole analysis and erase completed normalized suggestions; only full-range new analysis is offered. Provider transport has a configured per-call total deadline (default20s), which is intentionally NOT increased or rewritten.

Owned fixes: spending service+routes, additive migration018/migrate, focused tests; Android organization repository/models/state/workspace+tests; maintained Android README and backend provider spec; fresh deployment bundle. No credentials/model/default timeout changes, live calls/deployment, financial writes, template-feature expansion, or unrelated apply/undo refactor.

## Decision / executable contract

- New runs use10 rows per Provider call (500 cap unchanged); old stored batch_size retains its value. Smaller calls are a mitigation, not a guaranteed Provider latency cure. More calls repeat catalog/prompt cost.
- Migration018 adds private checkpoint_json, transient-source/catalog digest, fixed batch_size, attempt, and resume request ledger. Shipped migrations are unchanged. Persist only normalized suggestions and cursor, frozen numeric boundaries, no original notes/prompts/raw outputs.
- Checkpoint result+cursor+progress commit is atomic. Public suggestions/template columns remain empty and note-suggestion rows absent until ALL batches pass. Failed runs have no actionable card/apply.
- POST `/api/v1/ai/organization-runs/:id/resume` with clientRequestId is explicit user authorization for another Provider attempt. Resume same run, same frozen scope, starts at first uncommitted batch; no automatic resume/retry on GET/start replay/boot.
- `attempt` starts1; max3 user-authorized attempts/run. Replay same resume UUID returns current snapshot even after that attempt fails; new UUID is required for a new explicit paid attempt. 24h eligibility from immutable createdAt, non-sliding; each accepted attempt has10min monotonic budget. Expiry bounds resume admission, not exact completion instant.
- Source digest hashes exact rows including transient original note/financial facts and all category/tag/template/refund catalogs. Compare before paid resume and within final-publish transaction; stale source invalidates private checkpoint, no Provider call, requires new analysis. Conservative unrelated catalog changes can invalidate safely.
- Resume uses CURRENT saved Provider config, without changing it. A previously timed-out call may already incur charges; only committed completed batches are guaranteed not to be requested again, not exactly-once Provider billing.
- Timeout retains valid checkpoint if attempts/expiry permit; malformed response/config/non-timeout failure/interrupted active work clears checkpoint. Startup marks running jobs interrupted and never calls AI. Expired failed checkpoints are purged at startup and explicit resume admission; GET stays read-only.
- Additive public run fields `attempt` and `canResume`; no new status enum. Android has explicit cost-disclosed Continue-unfinished button distinct from GET Continue-viewing, keeps same run+resume UUID on network uncertainty, only authorizes increased-attempt transitions after user gesture.
- Transport timeout has no structural-field label if field is null. Failed progress timeline remains visible.

## Validation

Tests must prove10-row boundaries, batch2 timeout retains only private committed batch1, explicit resume never requests completed IDs, same UUID exact replay after ready/failed does not cost another call, max3/expiry/old-run behavior, source/catalog mutations and final-source races rejected, restart no auto work, strict five arrays preserved, auth/CSRF route registration and Android attempt/replay gates.

Independent source review caught missing expiry cleanup and stale-checkpoint invalidation; fixed without adding mutating GET. Existing apply/undo stale-source and duplicated combined after-projection issues remain outside this timeout patch; no full-PRD acceptance claim.

## Final verification and deliverables

- Backend full36 files/771 tests PASS; lint/typecheck/build PASS. Final auth/CSRF resume+checkpoint targeted20 tests PASS after route-guard assertions.
- Android full24 suites/269 tests,0failures/errors; lintDebug0errors/43warnings; assembleDebug PASS. APK22218130 bytes SHA256 `60570A91B87B1B3CD12ADA194DE1DE40D95041343549AA45855A83FEF228BBEE`.
- Complete backend source bundle `artifacts/jizhang-api-source-ai-resume-20261023.tar.gz`:117 allowlisted files,398602bytes, verified SHA manifest; checksum sidecar provided. Runbook `artifacts/DEPLOY-ai-resume-20261023.md` preserves production config/data/secret and schema18 copy-only trial.
- Device unavailable in adb at final check; no install/live Provider/production operation claimed. No git staging/commit/archive.

## Bug analysis / prevention

Category E implicit assumption + D coverage gap: fixed25-row response assumed it fit a20s per-call deadline, and successful mocked latency did not exercise delayed batch2. Previous prompt fix addressed a different B cross-layer contract defect; progress made the subsequent actual timeout distinguishable, not a regression of that same schema issue. Prevention now executable: timeout batch2 deterministic regression, atomic private checkpoint, explicit paid attempt UUID, monotonic progress/attempt validator, source/catalog digest before resume/publish and expiry/max3 bounds. Smaller10-row requests are engineering mitigation, not a claimed live latency benchmark. Domain spec and Android inventory updated; no absent upstream Trellis template tree is fabricated or unrelated mixed WIP committed.
