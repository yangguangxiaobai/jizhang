import json, pathlib
b=pathlib.Path('/opt/jizhang-backups/merged-import-20261017T154012Z')
before=json.load(open(b/'before-final-manifest.json'))['tables']; after=json.load(open(b/'after-manifest.json'))['tables']
changed=[k for k in before if k!='schema_migrations' and before[k]!=after.get(k)]
added=sorted(set(after)-set(before))
assert not changed,changed
assert added==['assistant_import_batch_categories','assistant_import_batch_operations','assistant_import_batch_rows','assistant_import_batches'],added
m=json.load(open(b/'after-migrations.json')); assert [x['version'] for x in m['migrations']]==list(range(1,13)); assert m['integrity']=='ok' and not m['foreignKeys']
old=json.load(open(b/'private-before-inspect.json'))[0]; current=json.load(open(b/'private-after-inspect.json'))[0]
oldenv=dict(x.split('=',1) for x in old['Config']['Env'] if '=' in x); newenv=dict(x.split('=',1) for x in current['Config']['Env'] if '=' in x)
keys=[k for k in oldenv if k not in {'PATH','NODE_VERSION','YARN_VERSION','COREPACK_ENABLE_DOWNLOAD_PROMPT','JIZHANG_IMAGE'}]
assert all(oldenv.get(k)==newenv.get(k) for k in keys); assert newenv['NODE_OPTIONS']=='--max-old-space-size=160'
assert old['Mounts']==current['Mounts']; assert current['Config']['User']=='node'; assert current['HostConfig']['PortBindings']['8081/tcp']==[{'HostIp':'127.0.0.1','HostPort':'8081'}]
assert set(current['NetworkSettings']['Networks'])=={'jizhang_default','jizhang_cutout-internal'}
newdeps={x['Name']:x for x in json.load(open(b/'private-after-inspect.json')) if x['Name'] != '/jizhang'}
expected={'/caddy':'1c193e276ec9ec27084355e6e88b3a0a7f5010710df72d31698f43a2902818c4','/jizhang-cutout':'72b7d257007ce792b374a966ae4a1e6c2184f4a9dcf467bc09daaa8e9e1f02ee','/komari':'d39ea46deede48164600f25b18919545ca038adf2e380b02e6ba2e16d6181434'}
for name,ident in expected.items(): assert newdeps[name]['Id']==ident and newdeps[name]['State']['Running']
print(json.dumps({'oldBusinessTablesUnchanged':True,'addedTables':added,'migrations':[x['version'] for x in m['migrations']],'integrity':'ok','foreignKeyViolations':0,'effectiveRuntimeEnvironmentValuesIdentical':True,'NODE_OPTIONS160MiB':True,'sameVolumePortNetworks':True,'dependenciesIDsAndStartTimesUnchanged':True,'beforeTransactionRows':before['transactions']['rows'],'afterTransactionRows':after['transactions']['rows']}))
