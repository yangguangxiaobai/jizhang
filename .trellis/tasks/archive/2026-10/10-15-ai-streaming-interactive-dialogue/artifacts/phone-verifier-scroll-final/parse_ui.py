import re, sys, io
path = sys.argv[1]
x = open(path, encoding='utf-8').read()
out = io.open(sys.argv[2], 'w', encoding='utf-8')
for m in re.finditer(r'<node[^>]*>', x):
    s = m.group(0)
    t = re.search(r'text="([^"]*)"', s)
    b = re.search(r'bounds="([^"]*)"', s)
    c = re.search(r'class="([^"]*)"', s)
    r = re.search(r'resource-id="([^"]*)"', s)
    d = re.search(r'content-desc="([^"]*)"', s)
    if t and t.group(1) and b:
        out.write("%s | %s | %s | %s | %s\n" % (t.group(1), b.group(1), c.group(1) if c else '', r.group(1) if r else '', d.group(1) if d else ''))
out.close()
