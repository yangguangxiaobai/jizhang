#!/usr/bin/env bash
set -euo pipefail
umask 077
id=20261017T154012Z
b=/opt/jizhang-backups/merged-import-$id
mkdir -p "$b/config" "$b/database"; chmod 700 "$b" "$b/config" "$b/database"
cd /opt/jizhang-production
lock=/opt/jizhang-production/maintenance.lock
[[ -f "$lock" && ! -L "$lock" && "$(stat -c '%u:%a' "$lock")" == 0:600 ]]
exec 9<>"$lock"; flock -n 9
[[ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" == "$(stat -c '%d:%i' "$lock")" ]]
for f in .env docker-compose.yml docker-compose.migration.yml runtime.override.yml image.override.yml manage.sh; do cp "$f" "$b/config/$f"; chmod 600 "$b/config/$f"; done
sudo -n /opt/jizhang-production/manage.sh config
# Capture topology/env privately; write only key names and equality digests, never values.
sudo -n docker inspect jizhang caddy jizhang-cutout komari > "$b/private-before-inspect.json"
sudo -n python3 - "$b" <<'PY'
import json,sys,hashlib,pathlib
b=pathlib.Path(sys.argv[1]); a=json.loads((b/'private-before-inspect.json').read_text()); x=a[0]
keys=['JIZHANG_AI_ENCRYPTION_KEY','JIZHANG_PASSWORD_HASH','JIZHANG_USERNAME','SESSION_TTL_DAYS','NODE_OPTIONS']
env=dict(v.split('=',1) for v in x['Config']['Env'] if '=' in v)
assert x['Config']['User']=='node'
assert any(m.get('Name')=='jizhang_jizhang-data' and m['Destination']=='/data' for m in x['Mounts'])
assert x['HostConfig']['PortBindings']['8081/tcp']==[{'HostIp':'127.0.0.1','HostPort':'8081'}]
assert set(x['NetworkSettings']['Networks'])=={'jizhang_default','jizhang_cutout-internal'}
assert x['State']['Health']['Status']=='healthy'
assert env.get('NODE_OPTIONS')=='--max-old-space-size=160'
for k in ['JIZHANG_AI_ENCRYPTION_KEY','JIZHANG_PASSWORD_HASH','JIZHANG_USERNAME']: assert env.get(k)
summary={'api':{k:x[k] for k in ['Id','Image','Created']},'startedAt':x['State']['StartedAt'],'user':x['Config']['User'],'mounts':[{k:m.get(k) for k in ['Type','Name','Source','Destination']} for m in x['Mounts']],'networks':sorted(x['NetworkSettings']['Networks']),'ports':x['HostConfig']['PortBindings'],'dependencyIds':{z['Name']:z['Id'] for z in a[1:]},'effectiveKeyNames':[k for k in keys if k in env],'effectiveValueDigests':{k:hashlib.sha256(env[k].encode()).hexdigest() for k in keys if k in env}}
(b/'before-topology-env-private.json').write_text(json.dumps(summary,indent=2)); print('Topology contract verified; effective env values compared by digest in protected directory only')
PY
# No active generations/provider stream or batch analysis may be interrupted.
sudo -n docker exec --user node jizhang node --input-type=module -e 'import{createRequire}from"node:module";import path from"node:path";const r=createRequire(path.resolve("packages/server/package.json"));const D=r("better-sqlite3");const d=new D("/data/jizhang.db",{readonly:true});const tables=new Set(d.prepare("select name from sqlite_master where type=?").all("table").map(x=>x.name));const live=tables.has("assistant_generations")?d.prepare("select count(*) c from assistant_generations where status in (?,?)").get("accepted","running").c:0;const batches=tables.has("assistant_import_batches")?d.prepare("select count(*) c from assistant_import_batches where analyse_state=?").get("running").c:0;if(live||batches)process.exit(3);console.log(JSON.stringify({liveGenerations:live,activeBatchAnalyses:batches}));d.close()' > "$b/before-active-work.json"
sudo -n docker exec --user node jizhang node deploy/db-manifest.mjs /data/jizhang.db > "$b/before-manifest.json"
sudo -n docker exec --user node jizhang node --input-type=module -e 'import{createRequire}from"node:module";import path from"node:path";const r=createRequire(path.resolve("packages/server/package.json"));const D=r("better-sqlite3");const d=new D("/data/jizhang.db",{readonly:true});console.log(JSON.stringify(d.prepare("select version,name from schema_migrations order by version").all()));d.close()' > "$b/before-migrations.json"
# Consistent sqlite snapshot through shipped CLI (not copying live .db).
sudo -n docker exec --user node jizhang node packages/server/dist/cli.js backup /data/backups/production-handoff 0 > "$b/backup-cli.log"
sudo -n python3 - "$b" <<'PY'
import pathlib,re,sys,subprocess,hashlib
b=pathlib.Path(sys.argv[1]); s=(b/'backup-cli.log').read_text(); names=set(re.findall(r'jizhang-\d{4}-\d{2}-\d{2}T[\d-]+\.db',s)); assert len(names)==1,s
name=names.pop(); subprocess.run(['docker','cp',f'jizhang:/data/backups/production-handoff/{name}',str(b/'database'/name)],check=True)
(b/'backup-name.txt').write_text(name+'\n'); p=b/'database'/name
print(json.dumps({'backupName':name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
PY
sudo -n chmod 600 "$b/database/"*
sudo -n docker exec --user node jizhang node deploy/db-manifest.mjs "/data/backups/production-handoff/$(cat "$b/backup-name.txt")" > "$b/backup-manifest.json"
sudo -n python3 - "$b" <<'PY'
import json,pathlib,sys
b=pathlib.Path(sys.argv[1]); a=json.loads((b/'before-manifest.json').read_text()); c=json.loads((b/'backup-manifest.json').read_text()); assert a==c, 'consistent backup differs from captured live manifest'; assert a['integrity']=='ok'; m=json.loads((b/'before-migrations.json').read_text()); assert [x['version'] for x in m]==list(range(1,12)),m
print(json.dumps({'tables':len(a['tables']),'preMigrationVersions':[x['version'] for x in m],'manifestMatches':True}))
PY
