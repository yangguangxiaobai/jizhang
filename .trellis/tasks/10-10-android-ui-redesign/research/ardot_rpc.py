"""Local Ardot MCP bridge; requests and responses retained as design evidence."""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent / 'ai-ardot-evidence'
FILE_URL = 'cocraft://localhost/file/729347012405452'


def call(name, arguments, label):
    ROOT.mkdir(parents=True, exist_ok=True)
    arguments = {'fileUrl': FILE_URL, **arguments}
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
               'params': {'name': name, 'arguments': arguments}}
    request = urllib.request.Request('http://127.0.0.1:50501/api/v1/mcp',
        data=json.dumps(payload).encode('utf-8'), headers={
            'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
    with urllib.request.urlopen(request, timeout=90) as response:
        raw = response.read().decode('utf-8')
    (ROOT / (label + '.raw.txt')).write_text(raw, encoding='utf-8')
    envelope = json.loads(next(line[6:] for line in raw.splitlines()
                              if line.startswith('data: '))) if raw.startswith('event:') or raw.startswith('data:') else json.loads(raw)
    (ROOT / (label + '.json')).write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding='utf-8')
    if 'error' in envelope:
        raise RuntimeError(envelope['error'])
    return envelope['result']


if __name__ == '__main__':
    name, argument_path, label = sys.argv[1:]
    args = json.loads(Path(argument_path).read_text(encoding='utf-8'))
    sys.stdout.buffer.write(json.dumps(call(name, args, label), ensure_ascii=False, indent=2).encode('utf-8'))
