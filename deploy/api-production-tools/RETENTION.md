# Enrolled host snapshot retention

## Delivery and approval boundary

Maintenance-only deployment completed on 2026-10-14 after independent check PASS
and explicit rollout approval. Reviewed tools, shared lock and empty registry are
installed; `.env`, Compose files and API image bytes/references were unchanged.
Initial sudo preview has zero rows/candidates/reclaimable bytes and apply_ready=false.
At initial rollout no backup was copied/enrolled. The separately approved follow-up
at 2026-10-14T05:28:24Z copied and enrolled the existing bill-import snapshot,
pinned and associated with `api-bill-import-20261014T034500Z`, with a matching
locally verified off-server receipt. There is ONE distinct verified managed point,
zero candidates, and apply_ready=false (minimum three not met). Original host and
local copies remain unchanged. No fresh backup, apply or systemd installation/
activation occurred. Evidence: task `enrollment-status.md`.
Legacy host/app backup trees and the historical archive remain unmanaged/protected.
Evidence: `.trellis/tasks/10-14-backup-retention/deploy-status.md`. No production apply or timer activation is authorized.
First remote acceptance is read-only preview/status, permissions and checksums;
compare container identities and health before/after. This is not evidence of
production ledger acceptance or a completed off-server restore drill.

Only `/opt/jizhang-backups/retention/*.db` entries explicitly enrolled in the
protected registry are eligible. This new dedicated root avoids enrolling a
historical live database, migration evidence or rollback config accidentally.
Legacy backup trees, `/data/backups`, source, images, archives, live volumes and
all off-server/local copies are outside apply scope. No root override CLI exists.
Unregistered entries inside the managed root are reported `unmanaged-pinned`.
Older unknown archives outside it are excluded, not secretly classified.

## Installation prerequisites (operator, after independent review)

Requires Linux/Python 3.10+ with SQLite, Docker, Bash and util-linux `flock`.
Deliver `retention.py`, existing `archive.py` (shared Docker reference helpers),
and changed `manage.sh` to the production directory, root-owned mode 700. Save
old wrapper privately first. Check source SHA256 and LF before/after delivery.
Protected JSON rejects duplicate keys at any depth and nonfinite numbers; ambiguous
registry, plan or receipt data is refused rather than interpreted last-key-wins.
Create new directories only after checking parents are canonical/root-owned and
not writable by group/others; do not chmod/reclassify a legacy tree blindly:

```bash
sudo install -d -o root -g root -m 700 /opt/jizhang-production/retention-state
sudo install -d -o root -g root -m 700 /opt/jizhang-backups/retention
# One-time creation only. Never truncate/replace an existing lock inode.
sudo sh -c 'umask 077; set -C; : > /opt/jizhang-production/maintenance.lock'
sudo python3 /opt/jizhang-production/retention.py init
sudo python3 /opt/jizhang-production/retention.py
```

If the lock exists, privately validate root ownership, regular/non-symlink,
mode 600 and canonical parents, then reuse it. Registry, plans, receipts and audit
are root-owned mode 600; state/root directories mode 700. No secrets or ledger
content belong in registry/receipt files. `init` refuses an existing registry.
An empty registry reports zero points/no eligible deletion; not a failure of
retention selection and not proof that three usable backups exist.

## Shared cooperative deployment lock

`manage.sh up` and `backup`, and every retention command, acquire exclusive
nonblocking flock on `/opt/jizhang-production/maintenance.lock`. Lock replacement
is rejected. This protects cooperative callers only. Direct Docker, archive.py,
historical cutover helpers, manual config writers and uncooperative processes do
not automatically participate. During future deployment hold this same lock for
the ENTIRE config-edit/capture/recreate/validation window. Do not call the locking
wrapper recursively under an independently acquired flock (it will refuse).
Operators may run the exact fixed Compose operation within their locked session;
never add down/volume prune. Initial maintenance file installation also needs a
quiet operator window, before starting any wrapper/retention operation.

The lock does not make Docker and filesystem operations atomic. Keep external
writers suspended. Path/stat/hash and container references are rechecked, but
root-owned external writers can still race after checks; this tool does not claim
protection against them. No deployment-pending marker separate from the lock is
used: lock ownership for the full window is the pending-deployment protocol.

## Generate and enroll a new recovery point

Enrollment does not generate a backup or change production data. Generate the
snapshot using the existing WAL-consistent CLI, not by copying `/data/jizhang.db`:

```bash
sudo /opt/jizhang-production/manage.sh backup
```

Privately note the exact reported filename under
`/data/backups/production-handoff/jizhang-YYYY-MM-DDTHH-MM-SS-mmm.db`.
After backup succeeds, hold the shared lock while copying that COMPLETED snapshot
with `docker cp jizhang:/data/backups/production-handoff/<exact-name>.db` into a
new private staging directory outside the managed root. Do not copy sidecars or
live DB. Reject an existing final filename, check staged file is a regular
non-symlink, then `install -o root -g root -m 600` it at the same basename inside
the managed root. This is a manual, cooperative transfer, not an automatic remote
copy workflow. Release the lock before calling the locking enrollment command:

```bash
sudo python3 /opt/jizhang-production/retention.py enroll \
  /opt/jizhang-backups/retention/<exact-name>.db
# For rollback-associated or explicitly protected snapshots:
# append --pin and/or --release api-bill-import-20261014T034500Z
```

Enrollment requires canonical allowlisted path, root/private permissions, one
hardlink, no WAL/SHM/journal sidecar, valid CLI basename/UTC timestamp, SHA256 and
stable device/inode/size/mtime/ctime. It runs SQLite integrity_check, copies via
SQLite backup API into a temporary isolated DB, checks restored integrity and
application tables (users, transactions, schema_migrations), then rehashes source.
All SQLite connections close explicitly. This verifies file readability/restoration,
NOT app-version compatibility, external secret availability or full ledger totals.
The operator must confirm snapshot provenance from successful consistent CLI.
Failed generation must never be enrolled; it does not modify retention selection.
Legacy migration evidence must remain pinned/unmanaged unless separately approved.

## Required next-deployment enrollment checklist (manual)

This checklist is an operator procedure for a separately authorized FUTURE deployment,
not permission to create a backup, change production or run cleanup now. Neither
`manage.sh backup` nor `manage.sh up` automatically enrolls snapshots. Completion of
an image deployment does not imply retention enrollment completion.

1. Confirm deployment authorization, current healthy API/topology, canonical
   root-private state/root/lock and reviewed executable checksums. Preserve current
   and available usable rollback images/configs. Keep other writers suspended.
2. Generate ONE consistent snapshot with `sudo /opt/jizhang-production/manage.sh
   backup` (retain-days=0). Capture the actual successful CLI filename, not the newest
   file guessed by mtime. If generation/verification fails, stop; do not enroll or
   delete older points. Record its UTC name and the release it supports: a pre-update
   snapshot normally belongs to the pre-update/rollback release, NOT automatically
   the future image tag.
3. Hold the existing cooperative lock for completed-snapshot transfer. Check lock
   canonical path/ownership/mode/inode before and after flock; never recreate it.
   Copy ONLY `jizhang:/data/backups/production-handoff/<actual-successful-name>.db`
   to a new root-private staging directory. Reject links, sidecars, existing final
   filename and unexpected file identity. Hash the staged regular snapshot. Install
   root:root mode 600 into `/opt/jizhang-backups/retention/<same-name>.db`, checking
   absence first within the quiet lock window; never replace an existing snapshot.
   Verify staged/managed SHA256 equality. Preserve staging and original copies.
   Release this transfer lock before calling the locking tool below.
4. Copy that completed snapshot to a private off-server location. Independently hash
   the received file and perform read-only integrity plus isolated SQLite backup/
   restore integrity and required-table checks (`users`, `transactions`,
   `schema_migrations`). Rehash the original afterward. Missing/mismatched local
   file or failed verification means STOP: do not fabricate a receipt. Record path,
   bytes, UTC check time, hash and verification limits privately; never output rows
   or secret values. A matching copy counts as the SAME recovery point, not another.
5. Create a NEW root:root mode-600 receipt under retention-state using the exact
   three-field schema below. Use the verified off-server SHA256, actual UTC check
   time and a unique bounded receipt_id. Never reuse placeholder evidence.
6. Enroll using the reviewed public CLI (replace every placeholder with observed
   values; release ID is the actual snapshot-supported release):

   ```bash
   sudo python3 -B /opt/jizhang-production/retention.py enroll \
     /opt/jizhang-backups/retention/<actual-successful-name>.db \
     --pin --release <snapshot-supported-release-id> \
     --offserver-receipt /opt/jizhang-production/retention-state/<unique>.receipt.json
   sudo python3 -B /opt/jizhang-production/retention.py preview
   ```

   Do not run these inside an independently held flock. Enrollment performs server
   isolated restoration/rehash and registry validation. If already enrolled, stop
   and inspect protected state; do not edit fingerprints or reset the registry to
   retry. `attest` is only for a previously enrolled matching point awaiting actual
   off-server evidence. Release-associated snapshots remain retained indefinitely
   by this version; there is no automatic unpin/release retirement command.
7. Preserve sanitized enrollment/preview evidence and service/config comparison.
   Confirm pin/release/receipt, distinct count, retained reasons, candidates/bytes
   and apply_ready explicitly. A third copy does not satisfy minimum-three. Failed
   enrollment leaves an unmanaged protected file; investigate without deletion.
8. Separately hold the shared lock for the whole authorized config-edit/recreate/
   validation deployment window, following the lock section (no recursive wrapper).
   Record the enrollment and production outcome separately. No apply or timer
   enable is part of this checklist; actual candidates need later explicit review.

No daily backup cadence or automatic enrollment is provided. Independent recovery
points must come from real successful snapshots; do not produce redundant copies
or claim three points merely to satisfy the gate.

## Off-server copy evidence

Copy the completed snapshot off-server independently. Verify SHA256 and perform
an isolated restore/read check there; do not overwrite a live DB anywhere. Retain
private operator evidence. Create a root-private receipt in retention-state with
exactly these fields (example values are placeholders, not actual evidence):

```json
{"sha256":"<64 lowercase hex of the verified off-server snapshot>",
 "checked_at":"2026-10-14T12:00:00+00:00",
 "receipt_id":"operator-drill-20261014-01"}
```

The timestamp must be UTC, no earlier than backup creation and not in the future;
receipt_id is a bounded simple identifier, not an arbitrary note or secret.
Hash must match the enrolled source. Either provide `--offserver-receipt` at
enrollment, or attest after the remote transfer:

```bash
sudo python3 /opt/jizhang-production/retention.py attest \
  /opt/jizhang-backups/retention/<exact-name>.db \
  --offserver-receipt /opt/jizhang-production/retention-state/receipt.json
```

This is an OPERATOR ATTESTATION, not automatic off-server proof. Every retained
managed copy needs matching evidence before apply can become ready. The server
never deletes or probes local/off-server files. Full app compatibility and ledger
acceptance require a separate restore drill; SQLite readability is not enough.

## Preview and apply review

UTC disjoint windows: [0,7) days keep all; [7,30) keep newest distinct hash per
ISO week; [30,180) keep newest per UTC month; >=180 otherwise eligible. Always
keep latest three distinct verified hashes, pins and ALL release associations.
Copies count once; every copy of a retained hash stays. Identical copies with
differing dates use the newest timestamp conservatively. Fewer than three points,
any enrolled invalid/referenced point or missing retained off-server evidence
blocks all deletion. Unknown files are individually pinned. Preview lists reasons,
bytes and newest verified timestamp; retention cannot recreate missed backups.

```bash
sudo python3 /opt/jizhang-production/retention.py preview \
  --save-plan /opt/jizhang-production/retention-state/review.plan.json
```

Default preview writes no registry/report; it uses the pre-existing shared lock
and temporary isolated verification DB. --save-plan explicitly writes a private
plan. Plans bind exact registry/policy digests and expire after 900 seconds.
Separately approve ACTUAL candidates; expired/drifted plans need another preview
and approval. No production apply was run in this task.

Later manual interface: `retention.py apply --plan <protected-plan>
--approved-plan-sha256 <printed-digest>`. Requires root, shared lock, exact renewed
preview, healthy API, original named /data volume, production Compose labels/files,
container-reference and full recovery verification before EACH unlink. Audit
intent/result are fsynced; registry replacement is atomic/fsynced. On partial
failure stop and inspect private audit/missing paths; reconcile only after review.
No automatic rollback or additional cleanup. Audit write failure after unlink
cannot undo deletion; the preceding durable intent remains evidence.

## Releases, schedules and limitations

Image/source/config cleanup is out of scope. Keep current plus two verified usable
prior releases (or all available if fewer), associated configs and active/stopped
references. This tool keeps EVERY release-associated snapshot; it does not assess
image compatibility or invent a list of three usable releases. Legacy migration
materials remain pinned/unmanaged. Most existing space is historical images and
will not be reclaimed by this rollout.

Systemd report service/timer are disabled source templates, not installed/enabled.
Cleanup `.disabled` templates deliberately run `/usr/bin/false`: unattended deletion
would bypass per-plan approval, so requires later design/approval, not a rename.
No daily backup cadence added. Audit/report storage needs operator monitoring;
no broad log pruning. Shared flock protects cooperative callers only; uncooperative
root writers may race final checks. Linux ownership/flock/systemd acceptance must
be validated independently; Windows unit fixtures mock ownership/locking.
