import re,sys,io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
p=sys.argv[1]
d=open(p,encoding='utf-8').read()
seen=[]
for m in re.finditer(r'<node[^>]*>',d):
    t=m.group(0)
    text=re.search(r'\btext="([^"]*)"',t)
    cd=re.search(r'content-desc="([^"]*)"',t)
    b=re.search(r'bounds="([^"]*)"',t)
    cl=re.search(r'clickable="([^"]*)"',t)
    en=re.search(r'enabled="([^"]*)"',t)
    txt=(text.group(1) if text else '') or (cd.group(1) if cd else '')
    if txt.strip():
        seen.append(f"{txt!r} bounds={b.group(1) if b else ''} clickable={cl.group(1) if cl else ''} enabled={en.group(1) if en else ''}")
print(f"NODES_WITH_TEXT={len(seen)}")
for s in seen: print(s)
