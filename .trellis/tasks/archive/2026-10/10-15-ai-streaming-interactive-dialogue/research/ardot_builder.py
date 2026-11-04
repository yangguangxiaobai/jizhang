"""Ardot Design Generator for AI Streaming & Interactive Dialogue
Generates 5 demonstration screens on Page 20:1 at y = 3696.
Follows batch_edit rules: <= 25 ops per call, unique binding names, explicit sizes/fills/AutoLayout.
"""
import json
import sys
import urllib.request
from pathlib import Path

FILE_URL = 'cocraft://localhost/file/729347012405452'
EVIDENCE_DIR = Path(__file__).parent / 'ardot-evidence'
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
MCP_ENDPOINT = 'http://127.0.0.1:50501/api/v1/mcp'


def call_mcp(name, arguments, label):
    arguments = {'fileUrl': FILE_URL, **arguments}
    payload = {
        'jsonrpc': '2.0',
        'id': 1,
        'method': 'tools/call',
        'params': {'name': name, 'arguments': arguments}
    }
    req = urllib.request.Request(
        MCP_ENDPOINT,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        }
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read().decode('utf-8')
    (EVIDENCE_DIR / f'{label}.raw.txt').write_text(raw, encoding='utf-8')
    lines = [line[6:] for line in raw.splitlines() if line.startswith('data: ')]
    envelope = json.loads(lines[0]) if lines else json.loads(raw)
    (EVIDENCE_DIR / f'{label}.json').write_text(
        json.dumps(envelope, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    if 'error' in envelope:
        raise RuntimeError(envelope['error'])
    return envelope['result']


def run_batch(ops, label):
    print(f'Executing batch: {label} ({len(ops.strip().splitlines())} lines)...')
    res = call_mcp('batch_edit', {'operations': ops.strip()}, label)
    txt = res.get('content', [{}])[0].get('text', '')
    data = json.loads(txt) if txt.startswith('{') else txt
    print(f'  -> Result: {txt[:200]}')
    return data


if __name__ == '__main__':
    print('Starting Ardot Design Generation...')
