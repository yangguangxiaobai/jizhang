# Implementation plan

## Entry gate
- [ ] Present final summary and obtain a subsequent explicit approval per trellis-brainstorm.
- [ ] Activate the approved implementation child and dispatch trellis-implement with its curated context. Main session coordinates; trellis-check verifies changed scope.

## Ordered execution
1. Audit Android feature/API gaps and record a concrete parity checklist based on real code. Inspect available Gradle/JDK/SDK, Docker, backend dependencies and devices.
2. Complete Android core auth/session/default URL and full feature gaps; add meaningful regression tests for observed failure classes. Use local API fixtures/seed ledger for integration.
3. Retire production Web hosting and Docker build artifacts (retire-web stage 1); API-only server must reject root/old pages even if static files remain on disk.
4. Produce API-only image/Compose and host/container Caddy examples. Keep old volume naming/migration instructions explicit, preserve optional cutout support.
5. Verify backups/restoration, inspect actual server topology/access, deploy new image with the preserved data, validate Caddy, then reload. Verify HTTPS health/auth and APK login -> transaction -> budget change with the existing ledger.
6. Complete the full Android parity checklist and install/runtime checks on Android and Harmony 4. External missing evidence remains pending.
7. Extract necessary non-UI contracts/fixtures, then retire-web stage 2 removes Web source and dedicated tooling. Verify clean builds/tests without packages/web and update active docs/specs.
8. Run final trellis-check, update specs, then project commit/finish workflow. Do not include unrelated existing skill/tool edits.

## Validation commands
- pnpm --filter @jizhang/shared build
- pnpm --filter @jizhang/shared test
- pnpm --filter @jizhang/server typecheck
- pnpm --filter @jizhang/server lint
- pnpm --filter @jizhang/server test
- pnpm --filter @jizhang/server build
- clients/android/gradlew.bat :app:assembleDebug :app:lintDebug
- clients/android/gradlew.bat :app:assembleRelease :app:lintRelease (from Android directory)
- docker compose config --quiet
- docker compose build jizhang (include cutout when relevant)
- HTTP checks at loopback and https://jz.yansuu1.xyz/api/v1/health; root and old SPA paths return JSON 404.
- Server-specific Caddy validate/reload only after topology inspection; backup restore and ledger comparison before/after migration.

## Risk and rollback points
Retain old server image/config and verified backup before deployment; use correct existing data volume. Schema migration rollback requires restoring a compatible backup alongside the old image. Preserve signing key for APK upgrades. Full Web source removal follows parity acceptance; Git history enables source recovery. Unavailable infrastructure is recorded, not replaced by invented validation.
