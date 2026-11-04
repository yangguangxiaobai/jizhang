"""Verify all 5 updated Ardot demonstration screens
- Capture screenshots for 32:11, 32:75, 32:123, 32:172, 32:214
- Check layout problems with capture_layout
- Batch read the node structures
"""
import json
import urllib.request
from pathlib import Path

FILE_URL = 'cocraft://localhost/file/729347012405452'
EVIDENCE_DIR = Path(__file__).parent / 'ardot-evidence'
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
MCP_ENDPOINT = 'http://127.0.0.1:50501/api/v1/mcp'
NODE_IDS = ['32:11', '32:75', '32:123', '32:172', '32:214']


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


def main():
    abs_evidence_dir = str(EVIDENCE_DIR.resolve())
    print("=== Step 1: Taking screenshots for 5 screens ===")
    res_ss = call_mcp('capture_screenshot', {'nodeIds': NODE_IDS, 'screenShotDir': abs_evidence_dir}, 'verified_screenshots')
    print("Screenshot result:")
    print(res_ss.get('content', [{}])[0].get('text', ''))

    print("\n=== Step 2: Checking layout for each screen ===")
    for nid in NODE_IDS:
        res_lay = call_mcp('capture_layout', {'parentId': nid, 'problemsOnly': True}, f'layout_check_{nid.replace(":", "_")}')
        txt = res_lay.get('content', [{}])[0].get('text', '')
        try:
            data = json.loads(txt)
            problems = data.get('data', [{}])[0].get('problems', {})
            print(f"Screen {nid} layout problems: {problems}")
        except Exception as e:
            print(f"Screen {nid} layout check output: {txt[:150]}")

    print("\n=== Step 3: Batch read all 5 screens ===")
    res_br = call_mcp('batch_read', {'nodeIds': NODE_IDS}, 'verified_batch_read')
    txt_br = res_br.get('content', [{}])[0].get('text', '')
    print(f"Batch read output: {txt_br[:200]}")


if __name__ == '__main__':
    main()
