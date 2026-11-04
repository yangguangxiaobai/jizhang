# Design: Web retirement

Parent design: ../10-09-android-server-delivery/design.md

## Ownership and boundaries
Own server static hosting/config/tests, Web-specific Docker/root tooling and the final removal of packages/web. Stage 1 and stage 2 are separate gates; stage 2 depends on Android parity acceptance and test extraction.

## Contracts and rollback
Follow the parent architecture, migration and evidence rules. Preserve existing API/session/data behavior. User scope was clarified on 2026-10-09.
