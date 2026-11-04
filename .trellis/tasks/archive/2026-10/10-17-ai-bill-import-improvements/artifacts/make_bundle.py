from pathlib import Path, PurePosixPath
import hashlib, tarfile, io, gzip
root=Path.cwd(); out=root/'.trellis/tasks/10-17-ai-bill-import-improvements/artifacts/merged-import-source.tar.gz'
fixed=['.npmrc','.dockerignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','Dockerfile','packages/server/package.json','packages/server/tsconfig.json','packages/shared/package.json','packages/shared/tsconfig.json','deploy/db-manifest.mjs']
files=[root/x for x in fixed]
for base in ['packages/server/src','packages/shared/src']:
 files += sorted(p for p in (root/base).rglob('*.ts') if p.is_file() and not p.is_symlink())
files=sorted(set(files),key=lambda p:p.relative_to(root).as_posix())
assert all(p.is_file() and not p.is_symlink() for p in files)
checks=[]
with out.open('wb') as raw:
 with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as gz:
  with tarfile.open(fileobj=gz,mode='w') as tar:
   for p in files:
    name=p.relative_to(root).as_posix(); data=p.read_bytes(); info=tarfile.TarInfo('source/'+name); info.size=len(data); info.mode=0o644; info.mtime=0; tar.addfile(info,io.BytesIO(data)); checks.append((name,hashlib.sha256(data).hexdigest()))
   data=''.join(f'{h}  {n}\n' for n,h in checks).encode(); info=tarfile.TarInfo('source/SHA256SUMS'); info.size=len(data); info.mode=0o644; info.mtime=0; tar.addfile(info,io.BytesIO(data))
sha=hashlib.sha256(out.read_bytes()).hexdigest(); out.with_name(out.name+'.sha256').write_text(f'{sha}  {out.name}\n')
print(f'files={len(files)} size={out.stat().st_size} sha256={sha}')
for n,h in checks: print(f'{h}  {n}')
