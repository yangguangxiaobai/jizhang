#!/usr/bin/env bash
# This helper is ONLY for the inspected Ubuntu server. No Caddy/worker changes.
set +x
set -Eeuo pipefail
umask 077

SOURCE=/opt/jizhang-api-2026-10-09/jizhang-api-source
ORIGINAL=/opt/jizhang
DATA_VOLUME=jizhang_jizhang-data
OLD_IMAGE=jizhang:64be4b1
NEW_IMAGE=jizhang:api-2026-10-09
WORKER_IMAGE=jizhang-cutout:64be4b1
TRIAL=jizhang-api-check
BACKUP_DIR=
PHASE=preflight
PREFLIGHT_ONLY=false
if [[ ${1:-} == --preflight-only && $# == 1 ]]; then
  PREFLIGHT_ONLY=true
elif [[ $# != 0 ]]; then
  echo 'Usage: bash cutover-known-server.sh [--preflight-only]' >&2
  exit 2
fi
fail() { echo "Cutover stopped: $*" >&2; exit 1; }
for command in docker python3 curl sha256sum cmp find sort tr cp mkdir chmod date sleep; do
  command -v "$command" >/dev/null || fail "Missing prerequisite: $command"
done
[[ -d $SOURCE && -f $SOURCE/SHA256SUMS ]] || fail 'Expected verified source directory missing'
[[ -f $ORIGINAL/.env && -f $ORIGINAL/docker-compose.yml ]] || fail 'Original environment/Compose files missing'
[[ -f $SOURCE/.env && -f $SOURCE/docker-compose.migration.yml ]] || fail 'Prepared environment/migration overlay missing'
[[ -f /opt/caddy/etc/Caddyfile ]] || fail 'Inspected Caddy config path missing'
cd "$SOURCE"
# Protect against applying an unverified or subsequently edited source bundle.
sha256sum --check --status SHA256SUMS || fail 'Source checksum validation failed'
docker compose version >/dev/null
metadata=$(python3 - "$SOURCE" "$ORIGINAL" <<'PY'
import json, pathlib, stat, subprocess, sys
source, original = sys.argv[1:]
for path in (source, original, source + '/.env', original + '/.env', '/opt/caddy/etc', '/opt/caddy/etc/Caddyfile', '/opt/jizhang-backups'):
    checked = pathlib.Path(path)
    if checked.exists() and checked.resolve() != checked:
        raise SystemExit('Preflight: linked operational path rejected')
for path in (source + '/.env', original + '/.env'):
    if stat.S_IMODE(pathlib.Path(path).stat().st_mode) != 0o600:
        raise SystemExit('Preflight: environment file must have mode600')
def run(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('Preflight: required Docker inspection failed')
    return result.stdout
def container(name):
    return json.loads(run('inspect', name))[0]
def require(condition, message):
    if not condition: raise SystemExit('Preflight: ' + message)
app, worker, caddy = (container(name) for name in ('jizhang', 'jizhang-cutout', 'caddy'))
labels = app['Config'].get('Labels') or {}
project = labels.get('com.docker.compose.project')
require(project == 'jizhang', 'Compose project changed')
require(labels.get('com.docker.compose.service') == 'jizhang', 'App service label changed')
require(labels.get('com.docker.compose.project.working_dir') == original, 'Original project directory changed')
require(app['State']['Running'], 'Original app is not running')
require(app['Config']['Image'] == 'jizhang:64be4b1', 'Original image tag changed')
mounts = [m for m in app['Mounts'] if m['Destination'] == '/data']
require(len(mounts) == 1 and mounts[0]['Type'] == 'volume' and mounts[0]['Name'] == 'jizhang_jizhang-data', 'Original data mount changed')
require(len(app['Mounts']) == 1, 'Unsupported additional app mounts would be lost')
ports = app['HostConfig'].get('PortBindings', {}).get('8081/tcp')
require(ports == [{'HostIp': '127.0.0.1', 'HostPort': '8081'}], 'Original loopback port changed')
require(set(app['NetworkSettings']['Networks']) == {'jizhang_default', 'jizhang_cutout-internal'}, 'Original app networks changed')
require(worker['State']['Running'] and worker['Config']['Image'] == 'jizhang-cutout:64be4b1', 'Original worker state/image changed')
require(set(worker['NetworkSettings']['Networks']) == {'jizhang_cutout-internal'}, 'Worker private network changed')
require(caddy['State']['Running'] and caddy['Config']['Image'] == 'caddy:2' and caddy['HostConfig']['NetworkMode'] == 'host', 'Caddy topology/state changed')
require(any(m['Source'] == '/opt/caddy/etc' and m['Destination'] == '/etc/caddy' and not m['RW'] for m in caddy['Mounts']), 'Caddy config mount changed')
run('volume', 'inspect', 'jizhang_jizhang-data')
new_image = json.loads(run('image', 'inspect', 'jizhang:api-2026-10-09'))[0]
old_image = json.loads(run('image', 'inspect', 'jizhang:64be4b1'))[0]
require(old_image['Id'] == app['Image'], 'Old image tag no longer matches running app')
require(new_image['Config']['User'] == 'node', 'New image runtime user is not node')
for network in ('jizhang_default', 'jizhang_cutout-internal'):
    info = json.loads(run('network', 'inspect', network))[0]
    require((info.get('Labels') or {}).get('com.docker.compose.project') == project, 'Network project labels changed')
    if network.endswith('cutout-internal'): require(info['Internal'], 'Worker network is not internal')
running = run('ps', '-q').split()
for item in running:
    other = container(item)
    if other['Id'] != app['Id']:
        require(not any(m.get('Name') == 'jizhang_jizhang-data' for m in other['Mounts']), 'Another running container mounts production data')
trial = subprocess.run(['docker', 'inspect', 'jizhang-api-check'], capture_output=True, text=True)
trial_id = ''
if trial.returncode == 0:
    check = json.loads(trial.stdout)[0]
    require(check['Image'] == new_image['Id'], 'Named trial image changed')
    require(any(m.get('Name') == 'jizhang-api-check-20261009-163820' and m['Destination'] == '/data' for m in check['Mounts']), 'Named trial volume changed')
    trial_id = check['Id']
print('\n'.join([project, app['Id'], app['Image'], new_image['Id'], worker['Id'], caddy['Id'], trial_id]))
PY
) || fail 'Inventory mismatch; no service was stopped'
mapfile -t facts <<< "$metadata"
PROJECT=${facts[0]}
OLD_CONTAINER_ID=${facts[1]}
OLD_IMAGE_ID=${facts[2]}
NEW_IMAGE_ID=${facts[3]}
WORKER_ID=${facts[4]}
CADDY_ID=${facts[5]}
TRIAL_ID=${facts[6]:-}
echo 'Preflight passed: original volume/project, API image, retained worker and host-network Caddy.'

BACKUP_DIR="/opt/jizhang-backups/cutover-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker inspect jizhang > "$BACKUP_DIR/original-container.json"
cp "$ORIGINAL/.env" "$BACKUP_DIR/old.env"
cp "$SOURCE/.env" "$BACKUP_DIR/prepared.env"
# Docker --env-file is NOT a Compose dotenv parser. Capture the original
# container's literal effective environment for maintenance CLI containers.
python3 - "$BACKUP_DIR/original-container.json" "$BACKUP_DIR/effective.env" <<'PY'
import json, pathlib, sys
values = json.load(open(sys.argv[1]))[0]['Config']['Env']
if any('\n' in value or '\r' in value or '=' not in value for value in values):
    raise SystemExit('Preflight: effective environment cannot be encoded as Docker env-file')
pathlib.Path(sys.argv[2]).write_text('\n'.join(values) + '\n')
PY
# Keep the base source/SHA untouched. Its fixed NODE_OPTIONS must be replaced
# with the inspected original runtime value by a durable final Compose overlay.
python3 - "$BACKUP_DIR/original-container.json" "$BACKUP_DIR/runtime.override.yml" <<'PY'
import json, pathlib, sys
old = json.load(open(sys.argv[1]))[0]
effective = dict(line.split('=', 1) for line in old['Config']['Env'])
options = effective.get('NODE_OPTIONS', '')
override = {'services': {'jizhang': {'environment': {'NODE_OPTIONS': options.replace('$', '$$')}}}}
pathlib.Path(sys.argv[2]).write_text(json.dumps(override, indent=2) + '\n')
PY
# Canonical dollar export differs across Compose versions. Determine it using
# a separate harmless model, never by guessing from real credentials/options.
cat > "$BACKUP_DIR/serialization-probe.yml" <<'JSON'
{"services":{"probe":{"image":"busybox:1.36","environment":{"PROBE_ONE":"one$$two","PROBE_TWO":"one$$$$two"}}}}
JSON
docker compose --project-name jizhang-config-probe -f "$BACKUP_DIR/serialization-probe.yml" config --format json > "$BACKUP_DIR/serialization-probe.json"
SERIALIZATION_MODE=$(python3 - "$BACKUP_DIR/serialization-probe.json" <<'PY'
import json, sys
values = json.load(open(sys.argv[1]))['services']['probe']['environment']
pair = (values['PROBE_ONE'], values['PROBE_TWO'])
if pair == ('one$two', 'one$$two'): print('raw')
elif pair == ('one$$two', 'one$$$$two'): print('canonical')
else: raise SystemExit('Preflight: unsupported Compose dollar serialization')
PY
)
shopt -s nullglob
for file in "$ORIGINAL"/docker-compose*.yml "$ORIGINAL"/docker-compose*.yaml "$ORIGINAL"/compose*.yml "$ORIGINAL"/compose*.yaml; do
  cp "$file" "$BACKUP_DIR/$(basename "$file")"
done
cp /opt/caddy/etc/Caddyfile "$BACKUP_DIR/Caddyfile.unchanged"
chmod 600 "$BACKUP_DIR"/*
ROLLBACK_IMAGE="jizhang:rollback-cutover-$(date -u +%Y%m%dT%H%M%SZ)-$$"
docker tag "$OLD_IMAGE_ID" "$ROLLBACK_IMAGE"
printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP_DIR/rollback-image.txt"

# Edit only deployment keys; never source or display dotenv credentials.
python3 - "$BACKUP_DIR/old.env" "$SOURCE/.env" <<'PY'
import os, pathlib, re, sys, tempfile
original, target = map(pathlib.Path, sys.argv[1:])
updates = {'JIZHANG_IMAGE': 'jizhang:api-2026-10-09', 'JIZHANG_DATA_VOLUME': 'jizhang_jizhang-data', 'JIZHANG_ITEM_CUTOUT_SERVICE_URL': 'http://jizhang-cutout:8090', 'JIZHANG_CUTOUT_IMAGE': 'jizhang-cutout:64be4b1'}
lines = []
for line in original.read_text(encoding='utf-8-sig').splitlines():
    match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
    if not match or match.group(1) not in updates: lines.append(line)
lines += [f'{key}={value}' for key, value in updates.items()]
with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=target.parent, delete=False) as file:
    file.write('\n'.join(lines) + '\n')
    name = file.name
os.chmod(name, 0o600)
os.replace(name, target)
PY
compose=(docker compose --project-name "$PROJECT" --project-directory "$SOURCE" -f "$SOURCE/docker-compose.yml" -f "$SOURCE/docker-compose.migration.yml" -f "$BACKUP_DIR/runtime.override.yml")
printf '%q ' "${compose[@]}" > "$BACKUP_DIR/COMPOSE-COMMAND.txt"
printf '\n' >> "$BACKUP_DIR/COMPOSE-COMMAND.txt"
"${compose[@]}" config --quiet
# Inspect merged model privately before stopping; no environment is printed.
"${compose[@]}" --profile cutout config --format json > "$BACKUP_DIR/prepared-model.json"
python3 - "$BACKUP_DIR/prepared-model.json" "$BACKUP_DIR/original-container.json" "$SERIALIZATION_MODE" <<'PY'
import json, sys
model = json.load(open(sys.argv[1]))
app = model['services']['jizhang']
# Compose's canonical config export escapes literal dollars so its output can
# be loaded again. Compare the actual semantic value after exactly ONE decode.
if sys.argv[3] == 'canonical':
    app['environment'] = {key: value.replace('$$', '$') if isinstance(value, str) else value for key, value in app['environment'].items()}
assert app['image'] == 'jizhang:api-2026-10-09'
assert len(app['ports']) == 1
port = app['ports'][0]
assert port['host_ip'] == '127.0.0.1' and port['target'] == 8081 and str(port['published']) == '8081' and port['protocol'] == 'tcp'
assert model['volumes']['jizhang-data']['external'] and model['volumes']['jizhang-data']['name'] == 'jizhang_jizhang-data'
assert model['networks']['default']['name'] == 'jizhang_default'
assert model['networks']['cutout-internal']['name'] == 'jizhang_cutout-internal'
assert model['services']['jizhang-cutout']['image'] == 'jizhang-cutout:64be4b1'
old = json.load(open(sys.argv[2]))[0]
effective = dict(line.split('=', 1) for line in old['Config']['Env'])
# Fail BEFORE stopping if a copied dotenv or new base would change runtime data
# configuration/credentials. Never put actual secret values in diagnostic text.
runtime_keys = {'HOST', 'PORT', 'DATA_DIR', 'TZ', 'TRUST_PROXY', 'LOG_LEVEL', 'NODE_ENV', 'NODE_OPTIONS', 'SESSION_TTL_DAYS'}
runtime_keys.update(key for key in effective if key.startswith('JIZHANG_') and key not in {'JIZHANG_IMAGE', 'JIZHANG_DATA_VOLUME', 'JIZHANG_CUTOUT_IMAGE'})
# Missing optional keys matter too: adding a different encryption key must never
# silently change the ability to decrypt existing provider secrets.
critical_defaults = {'JIZHANG_USERNAME': '', 'JIZHANG_PASSWORD_HASH': '', 'JIZHANG_AI_ENCRYPTION_KEY': '', 'SESSION_TTL_DAYS': '30'}
for key, fallback in critical_defaults.items():
    expected = effective.get(key, fallback)
    actual = app['environment'].get(key, fallback)
    if str(actual or '') != expected:
        raise SystemExit('Preflight: effective runtime environment differs for ' + key)
for key in runtime_keys:
    if key in effective and str(app['environment'].get(key, '')) != effective[key]:
        raise SystemExit('Preflight: effective runtime environment differs for ' + key)
PY
echo 'Preflight passed: merged deployment preserves runtime credentials and original data topology.'
if $PREFLIGHT_ONLY; then
  echo "Protected preflight material: $BACKUP_DIR (no service stopped)"
  echo "Durable runtime override: $BACKUP_DIR/runtime.override.yml"
  exit 0
fi

cleanup_failure() {
  local status=$?
  if (( status != 0 )); then
    if [[ $PHASE == stopping || $PHASE == stopped ]]; then
      docker start "$OLD_CONTAINER_ID" >/dev/null || true
      echo 'Pre-recreation failure: original app restart attempted; verify its health.' >&2
    elif [[ $PHASE == recreating || $PHASE == verifying ]]; then
      docker stop jizhang >/dev/null 2>&1 || true
      echo 'New API stopped after failure. No database restore was performed.' >&2
      echo "Use protected rollback instructions: $BACKUP_DIR/ROLLBACK.txt" >&2
    fi
    echo "Protected rollback material: $BACKUP_DIR" >&2
  fi
}
trap cleanup_failure EXIT
if [[ -n $TRIAL_ID ]]; then docker stop "$TRIAL_ID" >/dev/null; fi
PHASE=stopping
docker stop "$OLD_CONTAINER_ID" >/dev/null
PHASE=stopped
docker run --rm --env-file "$BACKUP_DIR/effective.env" -e NODE_ENV=production -e DATA_DIR=/data \
  -v "$DATA_VOLUME:/data" "$ROLLBACK_IMAGE" node packages/server/dist/cli.js backup /data/backups/pre-api 0 \
  > "$BACKUP_DIR/final-backup.log" 2>&1
FINAL_BACKUP=$(python3 - "$BACKUP_DIR/final-backup.log" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
matches = re.findall(r'Backup ok: (/data/backups/pre-api/jizhang-[A-Za-z0-9-]+\.db)', text)
if len(matches) != 1: raise SystemExit('Final backup success/path not confirmed')
print(matches[0])
PY
)
printf '%s\n' "$FINAL_BACKUP" > "$BACKUP_DIR/final-backup-path.txt"
docker run --rm -v "$DATA_VOLUME:/data:ro" "$NEW_IMAGE" node deploy/db-manifest.mjs "$FINAL_BACKUP" \
  > "$BACKUP_DIR/final-snapshot-manifest.json"
mkdir "$BACKUP_DIR/data"
docker cp "$OLD_CONTAINER_ID:/data/." "$BACKUP_DIR/data/"
# JSON is valid Compose YAML. Escaping $ prevents Compose from interpreting
# argon2 hashes/other literal values as interpolation when rendering rollback.
python3 - "$BACKUP_DIR" "$ROLLBACK_IMAGE" <<'PY'
import json, pathlib, sys
directory = pathlib.Path(sys.argv[1])
old = json.loads((directory / 'original-container.json').read_text())[0]
effective = dict(line.split('=', 1) for line in old['Config']['Env'])
effective['WEB_DIST_DIR'] = '/app/public'
effective = {key: value.replace('$', '$$') for key, value in effective.items()}
override = {'services': {'jizhang': {'image': sys.argv[2], 'env_file': [{'path': str(directory / 'old.env'), 'required': True}], 'environment': effective}}}
(directory / 'rollback.override.yml').write_text(json.dumps(override, indent=2) + '\n')
PY
cat > "$BACKUP_DIR/ROLLBACK.txt" <<TEXT
All rollback commands require all production-data writers stopped.
Protected final pre-cutover snapshot: $FINAL_BACKUP
Old image: $ROLLBACK_IMAGE
Original data volume: $DATA_VOLUME
Source: $SOURCE
1. Stop the new API: docker stop jizhang
2. Preserve possible post-cutover writes before restore:
   docker run --rm --env-file '$BACKUP_DIR/effective.env' -e NODE_ENV=production -e DATA_DIR=/data -v '$DATA_VOLUME:/data' '$NEW_IMAGE' node packages/server/dist/cli.js backup /data/backups/post-cutover-preserved 0
   Keep/reconcile that snapshot; restoring the old snapshot discards later writes.
3. After deciding to restore the verified pre-cutover ledger, with every writer stopped:
   docker run --rm --env-file '$BACKUP_DIR/effective.env' -e NODE_ENV=production -e DATA_DIR=/data -v '$DATA_VOLUME:/data' '$ROLLBACK_IMAGE' node packages/server/dist/cli.js restore '$FINAL_BACKUP'
4. Restart ONLY the old app with original credentials and forced WEB_DIST_DIR=/app/public:
   docker compose --project-name '$PROJECT' --project-directory '$SOURCE' -f '$SOURCE/docker-compose.yml' -f '$SOURCE/docker-compose.migration.yml' -f '$BACKUP_DIR/runtime.override.yml' -f '$BACKUP_DIR/rollback.override.yml' up -d --no-build --no-deps --force-recreate jizhang
5. Verify health, login/ledger, retained worker and other sites. Caddy was never modified.
Never delete/prune volumes. Never restore while a writer is running.
TEXT
find "$BACKUP_DIR" -maxdepth 1 -type f -exec chmod 600 {} +
[[ $(docker inspect --format '{{.Id}}' jizhang) == "$OLD_CONTAINER_ID" ]] || fail 'Original app changed during preparation'
[[ $(docker image inspect --format '{{.Id}}' "$NEW_IMAGE") == "$NEW_IMAGE_ID" ]] || fail 'New image tag changed during preparation'
PHASE=recreating
"${compose[@]}" up -d --no-build --no-deps --force-recreate jizhang
PHASE=verifying
healthy=false
for attempt in {1..30}; do
  if curl --max-time 3 -fsS http://127.0.0.1:8081/api/v1/health > "$BACKUP_DIR/health.json" 2>/dev/null && \
    python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("status") == "ok" else 1)' "$BACKUP_DIR/health.json"; then
    healthy=true; break
  fi
  sleep 1
done
$healthy || fail 'New API health failed'
[[ $(curl --max-time 5 -sS -o "$BACKUP_DIR/root.json" -w '%{http_code}' http://127.0.0.1:8081/) == 404 ]] || fail 'Root did not return 404'
python3 -c 'import json; import sys; assert json.load(open(sys.argv[1]))["error"]["code"] == "NOT_FOUND"' "$BACKUP_DIR/root.json"
[[ $(docker exec jizhang whoami) == node ]] || fail 'Runtime user is not node'
[[ $(docker inspect --format '{{.Image}}' jizhang) == "$NEW_IMAGE_ID" ]] || fail 'Wrong image is running'
[[ $(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}{{end}}{{end}}' jizhang) == "volume|$DATA_VOLUME" ]] || fail 'Production data mount changed'
[[ $(docker inspect --format '{{.Id}}|{{.State.Running}}' jizhang-cutout) == "$WORKER_ID|true" ]] || fail 'Retained worker changed/stopped'
[[ $(docker inspect --format '{{.Id}}|{{.State.Running}}' caddy) == "$CADDY_ID|true" ]] || fail 'Caddy changed/stopped'
docker inspect --format '{{json .NetworkSettings.Networks}}' jizhang > "$BACKUP_DIR/app-networks.json"
docker inspect --format '{{json .NetworkSettings.Networks}}' jizhang-cutout > "$BACKUP_DIR/worker-networks.json"
python3 - "$BACKUP_DIR/app-networks.json" "$BACKUP_DIR/worker-networks.json" <<'PY'
import json, sys
app = json.load(open(sys.argv[1]))
worker = json.load(open(sys.argv[2]))
private = 'jizhang_cutout-internal'
if set(app) != {'jizhang_default', private}:
    raise SystemExit('App networks changed')
if set(worker) != {private}:
    raise SystemExit('Retained worker networks changed')
network_id = app[private].get('NetworkID')
if not isinstance(network_id, str) or not network_id or network_id != worker[private].get('NetworkID'):
    raise SystemExit('App and retained worker do not share the same private network')
PY
docker exec jizhang node deploy/db-manifest.mjs /data/jizhang.db > "$BACKUP_DIR/new-ledger-manifest.json"
cmp --silent "$BACKUP_DIR/final-snapshot-manifest.json" "$BACKUP_DIR/new-ledger-manifest.json" || fail 'Ledger manifest changed after recreation; preserve data and investigate'
PHASE=complete
echo 'CUTOVER_OK: API healthy, root JSON404, node user, original volume, worker/Caddy unchanged.'
echo "Protected rollback material: $BACKUP_DIR"
echo "Future Compose commands must retain runtime.override.yml; prefix recorded in $BACKUP_DIR/COMPOSE-COMMAND.txt"
echo 'Next: verify HTTPS login, historical ledger/photos, APK and new-entry budget change.'
