# Known-server API cutover

This helper is specific to the operator-inspected Ubuntu server. The new `jizhang:api-2026-10-09` image has been built there; the restored-volume trial passed health, root JSON404, non-root user and matching snapshot manifests. This prepares the final switch; it does not prove production has switched.

Fixed inputs: original project `/opt/jizhang`, new source `/opt/jizhang-api-2026-10-09/jizhang-api-source`, exact named volume `jizhang_jizhang-data`, old app/worker image tags `64be4b1`, current Caddy host-network container and its read-only `/opt/caddy/etc` mount. The original volume and server credentials are preserved. Do not use this helper on another topology or change its guarded constants to guesses.

Upload the helper and checksum from the workspace; the operator now has SCP access:

```bash
scp artifacts/cutover-known-server.sh artifacts/cutover-known-server.sh.sha256 ubuntu@jz.yansuu1.xyz:/opt/jizhang-upload/
```

In the server terminal:

```bash
cd /opt/jizhang-upload
sha256sum -c cutover-known-server.sh.sha256
sudo bash cutover-known-server.sh --preflight-only
sudo bash cutover-known-server.sh
```

Preflight rejects changed paths, symlinks, env permissions, old labels/images, unsupported mounts, networks, shared-data writers and effective credential/runtime differences before stopping services. The helper copies original inspected configuration into a unique mode700 directory under `/opt/jizhang-backups`, preserves the old image by ID, and updates only new-source deployment keys without shell-sourcing credentials.

`--preflight-only` also renders and privately validates the merged Compose model,
including absent/present AI keys and the effective session lifetime. It prepares
the private inspection files and rollback image tag and updates only the prepared
source's deployment keys; it stops or recreates no container. Diagnostics name
changed environment keys and never print their values.

It stops only the named isolated trial and original app, creates a final consistent no-prune snapshot and cold archive, then recreates **only `jizhang`** with the same inspected project and original external volume. The existing cutout worker remains running with its original container ID; Caddy is neither edited nor restarted. Pre-recreation failure restarts the original app. Successful checks cover health, JSON404, node user, original mount/private networks, unchanged worker/Caddy and final-ledger digests.

On post-recreation failure the helper stops the new API and reports the protected `ROLLBACK.txt`. It does not overwrite any database automatically. The instructions preserve possible post-cutover writes before deciding to restore the final pre-cutover snapshot, then restore the old image with exact captured runtime settings and `WEB_DIST_DIR=/app/public`. Keep these secret-bearing files private; do not upload or paste them. Never delete/prune data volumes or run a whole-stack down.

After `CUTOVER_OK`, verify public HTTPS root JSON404, login, existing ledger/photos/AI configuration, APK session recovery and a new-entry budget change. Container checks do not establish full user acceptance.

Network verification reads Docker's JSON object keys and checks that the app and retained worker share the same private NetworkID. It tolerates whitespace/trailing blank lines in CLI output. If a switch has already recreated the app and a later verification fails, do **not** rerun this one-time helper: its old-image preflight intentionally rejects the new app. Preserve the reported backup directory, verify the current new container/volume/image/networks, and resume that existing container through the operator's guarded recovery procedure; the final ledger comparison and HTTPS checks still need completion. No database restoration is automatic.

The inspected old container's `NODE_OPTIONS` is preserved exactly in a private `runtime.override.yml` outside the source directory. This corrects the base Compose's fixed heap option without editing its SHA-verified source or skipping runtime/credential checks. A separate harmless dollar sentinel detects whether this Compose version exports raw or escaped JSON values; comparisons decode one export layer only when that probe establishes it. Literal dollar characters in options and credentials remain intact. The probe only runs `config`, never starts a service, and is not included in the real deployment stack. The same runtime overlay is included for config, cutover and rollback; retain it for all later Compose operations. The exact command prefix is recorded in the successful cutover directory's `COMPOSE-COMMAND.txt`; append the operation to that prefix rather than running bare `docker compose up`. Only `NODE_OPTIONS` is added by this runtime overlay; auth and AI key guards remain active.

Local regression: `python -m unittest deploy.test_cutover -v` executes the actual
helper and embedded Python against fake Docker/HTTP commands in temporary paths.
It tests scoped successful recreation, preflight credential/key/TTL/volume rejection,
old-app restart on stop/backup/archive failure, and new-app stop without database
restore on recreation or ledger-verification failure. It contacts no Docker daemon
or server. Windows cannot validate POSIX file permissions; those checks remain
enforced by the unmodified production helper on Ubuntu.
