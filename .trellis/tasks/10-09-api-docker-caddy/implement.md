# Plan: API deployment

Parent execution sequence and commands: ../10-09-android-server-delivery/implement.md

- [x] Obtain final planning approval, then activate this child (user: 开始).
- [x] Research concrete gaps within owned scope and record evidence.
- [x] Prepare local Docker/Compose/Caddy and migration runbook; live deployment is pending.
- [ ] Run relevant parent validation commands and targeted regression checks.
- [ ] Dispatch trellis-check; address findings and record external pending checks.
- [ ] Update parity/deployment evidence and report acceptance to parent.

Ownership: Own API-only Docker/Compose, Caddy examples, migration/recovery procedures and deployment evidence. Coordinate Docker ownership with retire-web; this child implements image changes, retire-web owns static API behavior and final Web cleanup.

Local checks and external pending evidence: [deployment-evidence.md](./deployment-evidence.md). Main session owns review dispatch and final live acceptance. Confirmed domain is jz.yansuu1.xyz; no SSH is available.
