# Design: API deployment

Parent design: ../10-09-android-server-delivery/design.md

## Ownership and boundaries
Own API-only Docker/Compose, Caddy examples, migration/recovery procedures and deployment evidence. Coordinate Docker ownership with retire-web; this child implements image changes, retire-web owns static API behavior and final Web cleanup.

## Contracts and rollback
Follow the parent architecture, migration and evidence rules. Preserve existing API/session/data behavior. User scope was clarified on 2026-10-09.
