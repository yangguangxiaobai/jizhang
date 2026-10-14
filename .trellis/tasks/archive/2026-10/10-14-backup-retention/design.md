# Backup retention design

## Scope and ownership
Add maintenance tooling under deploy/api-production-tools rather than change accounting APIs or image startup. The first rollout manages explicitly enrolled deployment database snapshots and produces a read-only report. Legacy archives, initial migration snapshots, source bundles and Docker images are retained/pinned; no bulk directory deletion.

## Registry and recovery points
Use a protected versioned JSON registry with enrolled snapshot paths, creation time from verified naming/manifest, SHA256, verification evidence, off-server-copy status, pins and release association. Inventory of unregistered legacy files is advisory; age alone never grants deletion eligibility. Deduplicate identical copied snapshots by logical identity/hash for retention selection. Preserve all required copies of retained points; verify source copies before enrolling. No ledger content, environment values or credentials in reports.

## Policy
Use UTC time, disjoint windows: younger than 7 days all; 7–30 days newest point per ISO week; 30–180 days newest point per month; older eligible for removal. Additionally retain latest three verified distinct recovery points and all pins/release references. Backup generation remains WAL-consistent CLI and retains retain-days=0 to avoid competing age-only pruning. Existing app 30-day root-level policy is not expanded or silently changed; unmanaged app/legacy backups are explicitly disclosed as outside initial managed apply.

## Safety boundary
Allowlisted enrolled roots only, canonical paths, no symlink traversal, regular files only, validate file identity/hash/stat and registry before apply. Preview plan has bounded validity and registry/policy digest; apply recomputes and rejects drift. Do not count corrupt/new/unverified backups. Require healthy current service, sufficient verified retained points, off-server evidence for retained recovery and no pending deployment. Use shared advisory flock protocol in supported maintenance/deployment wrappers; document that direct Docker/manual operations must respect the same lock. Never claim protection from uncooperative writers.

## Deployment material
Track current plus two usable prior rollback releases when verified; if only one or two exist retain all, do not invent usability. Keep associated configs pinned. Image/source cleanup is report-only in this rollout; protected env/config directories never go through database-file unlink logic.

## Rollout
Local deterministic unit/mock tests first, deploy maintenance files without restarting API, run server dry-run. Present actual plan for user review. Destructive execution and daily destructive timer activation are separate approval gates; daily dry-run reporting can be prepared but not enabled before review. No server API image update required. Local/off-server copies inventoried separately, never deleted remotely.

## Limitations
Policy cannot recreate missed daily/monthly backups. Freshness is reported independently of retention; no new daily backup cadence in this task. Current space mostly legacy images, deliberately not reclaimed initially. Unknown legacy verification fails closed. Roll back tool/schedule config only, never restore or overwrite the live database.
