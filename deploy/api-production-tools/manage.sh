#!/usr/bin/env bash
# Fixed inspected production topology. Do not source .env or enable xtrace.
set -euo pipefail
umask 077
cd /opt/jizhang-production
export JIZHANG_DATA_VOLUME=jizhang_jizhang-data
for file in docker-compose.yml docker-compose.migration.yml runtime.override.yml image.override.yml .env; do
  [[ -f "$file" && ! -L "$file" ]] || { echo 'Required production file missing or symlinked' >&2; exit 1; }
done
compose=(docker compose -p jizhang --env-file /opt/jizhang-production/.env
  -f docker-compose.yml -f docker-compose.migration.yml
  -f runtime.override.yml -f image.override.yml)
[[ $# == 1 ]] || { echo 'Usage: manage.sh status|config|logs|up|backup' >&2; exit 2; }
# Shared cooperative lock: provision root-owned mode 600 once at installation.
# Never replace the lock inode. Direct deployments must hold the same lock for
# their entire config edit/recreation window, not merely the final compose call.
if [[ "$1" == up || "$1" == backup ]]; then
  lock=/opt/jizhang-production/maintenance.lock
  [[ -f "$lock" && ! -L "$lock" && "$(stat -c '%u:%a' "$lock")" == 0:600 ]] || {
    echo 'Protected maintenance lock missing or unsafe' >&2; exit 1;
  }
  exec 9<>"$lock"
  flock -n 9 || { echo 'Maintenance/deployment already in progress' >&2; exit 1; }
  [[ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" == "$(stat -c '%d:%i' "$lock")" ]] || {
    echo 'Maintenance lock identity changed' >&2; exit 1;
  }
fi
case "$1" in
  status) "${compose[@]}" ps -a ;;
  config) "${compose[@]}" config --quiet; echo 'Merged production configuration valid (values not printed)' ;;
  logs) "${compose[@]}" logs --tail 100 jizhang ;;
  up) "${compose[@]}" up -d --no-deps --no-build --pull never jizhang ;;
  backup) "${compose[@]}" exec -T jizhang node packages/server/dist/cli.js backup /data/backups/production-handoff 0 ;;
  *) echo 'Unsupported operation; down/restore/cleanup are deliberately unavailable' >&2; exit 2 ;;
esac
