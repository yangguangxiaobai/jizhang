# Implementation and Validation

1. Persist approved requirements/design, inspect existing provider contracts/specs and activate task.
2. Backend implement saved-config listing, safe URL derivation/transport/normalization, route; add unit/integration auth/CSRF/redaction/size/timeout/config-immutability tests.
3. Android independently implement repository/strict list parser/search and saved-connection ownership, picker UI/manual fallback; add JVM tests and maintained README stable IDs/API coverage/log changes.
4. Run targeted then full server tests/lint/typecheck/build, Android testDebugUnitTest/lintDebug/assembleDebug. Fix local failures; scoped review checks privacy/stale responses and no implicit save/inference. Preserve unrelated WIP.
5. Package allowlisted current server/shared source with manifest and SHA-256; write release deployment guide based on previous production runbook preserving external data volume/config/key and four absolute compose paths. Verify archive and APK digest. No production calls or deployment.
6. Record exact automated evidence and physical-device/live-provider gaps; deliver APK and server package. Do not stage/commit/archive without authorization.

## Approved layout follow-up

Frontend subagent owns ProviderSettings and local helper/tests per research/provider-layout-implementation.md; parent owns README and evidence. Preserve endpoint payload/secret/explicit operations while reorganizing sections and fixed actions. Run complete Android JVM/lint/assemble, scoped independent review and inspect final APK digest. Do not redeploy backend or auto-install in this layout-only turn.
