# Backup retention and bounded cleanup

## Goal
Prevent indefinitely accumulating deployment backups while retaining verified recovery points and protecting production data and active rollback resources.

## Consent and phase
User approved read-only inventory and the proposed retention rules, including preserving legacy archives/migration evidence. Final local implementation plan explicitly approved in the delegated dispatch. Independent review remains required before remote maintenance-only deployment. Destructive apply and schedule activation require later actual-candidate approval. No deletion or production configuration modification performed.

## Confirmed inventory (2026-10-14)
SSH read-only inventory of ubuntu@jz.yansuu1.xyz:
- /opt/jizhang-backups: 3.5 MiB; deployment backup/config/history trees, including initial cutover (2.5 MiB), api-cleanup (348 KiB), current bill-import backup (560 KiB). Nine .db paths includes archived live database and nested snapshot copies; not all are autonomous verified backups.
- /data/backups (inside current API): 2.5 MiB, eight .db files across default/pre-api/api-cleanup/before-cutout/production-handoff directories.
- /opt/jizhang-archive: 626 MiB; 559 MiB historical image exports, 55 MiB upload archive, 7.9 MiB release tree, 1.4 MiB historical source. Archive is not equivalent to database backup and requires separate reference-aware cleanup.
- /opt/jizhang-upload: 6.1 MiB. Current build source must not be deleted on a guessed age alone.
- Local artifacts/backups: one file, 434176 bytes.
- Current API image api-bill-import-20261014T034500Z healthy; cutout remains healthy. No state changes performed.

## Source evidence
- deploy/api-production-tools/manage.sh:19 calls backup with retain-days=0, explicitly disabling pruning.
- deploy/api-production-tools/README.md:46 documents intentionally no automatic old backup cleanup.
- packages/server/src/cli-db.ts:150–166 prunes only files directly within the target directory, when retainDays>0, using mtime and filename prefix/suffix. It does not recursively clean host backup/config directories.
- packages/server/src/services/portability-service.ts:1146–1157 uses 30 days for app-triggered backup in /data/backups only.
- deploy/API-PRODUCTION-README.md requires protected host and off-server copies and preserving current/rollback configuration; production entry is /opt/jizhang-production.

## Approved requirements
- R1: Distinguish database snapshots, deployment configuration/history, source bundles and image exports; no blanket directory pruning.
- R2: Database tiers: all in recent 7 days, one per ISO week through 30 days, one per UTC month through 180 days; always keep newest three verified independent recovery points and pinned backups. Deduplicate copied recovery points in inventory without counting copies as three independent backups.
- R3: Preserve current and two previous usable rollback releases plus associated configs. Active container references, unknown files, symlinks and incomplete/failed backups block deletion. Initial migration evidence and archives are pinned until explicitly approved for classification.
- R4: Default dry-run lists candidates and retained reasons/bytes. Apply must use explicit approved policy, bounded allowlisted roots, mutual exclusion with deployment, revalidation, audit records and no volume/docker-wide prune. Failed/new unverified backup must never trigger old deletion.
- R5: Daily scheduled cleanup is proposed only after reviewed dry-run; host and off-server local policy managed separately, no automatic deletion of local copies by a server job.

## Out of scope
Restore production database, delete original data volume, modify Caddy/cutout/Komari, global Docker prune, immediate legacy archive deletion, public backup upload.

## Acceptance criteria
- Deterministic dry-run explains each retained/candidate recovery point and estimated reclaimed bytes; copied identical snapshots do not satisfy the minimum-three rule independently.
- Date-tier boundary tests cover seven/thirty/180 days, UTC ISO weeks/months, pinned files and fewer than three verified points.
- Unknown/symlink/incomplete files, active releases and legacy archives are never removed.
- Apply revalidates candidates, verification and deployment-lock ownership; errors fail closed and audit output contains no secrets or ledger content.
- Initial server rollout is dry-run only. User reviews actual candidates before destructive apply or enabling a destructive daily schedule.
- Server and local copies remain separately managed; no automatic local deletion.

## Decisions and review gate
Retention policy approved. Legacy migration/archive materials remain pinned. No blocking product questions remain; final plan/local implementation approved; remote rollout waits for independent review. Automated deletion and destructive scheduling require a later review of actual server candidates.
