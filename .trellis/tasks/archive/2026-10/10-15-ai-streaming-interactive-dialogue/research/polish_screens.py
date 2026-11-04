"""Polish text layout and heights on AI14, AI16, and AI17
"""
import json
import urllib.request
from pathlib import Path

FILE_URL = 'cocraft://localhost/file/729347012405452'
EVIDENCE_DIR = Path(__file__).parent / 'ardot-evidence'
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
    lines = [line[6:] for line in raw.splitlines() if line.startswith('data: ')]
    envelope = json.loads(lines[0]) if lines else json.loads(raw)
    return envelope['result']


def run_batch(ops, label):
    print(f'Executing batch: {label}...')
    res = call_mcp('batch_edit', {'operations': ops.strip()}, label)
    txt = res.get('content', [{}])[0].get('text', '')
    print(f'  -> Result: {txt[:200]}')
    return txt


def main():
    print("=== Polishing Screens ===")
    # 1. AI14 (32:11): update top capsule stroke & text to titanium blue
    ops_ai14 = '''
U("32:18", {strokes: [{type: "SOLID", color: {r: 0.1843, g: 0.4353, b: 0.5608}, opacity: 1, visible: true, blendMode: "NORMAL"}], fills: [{type: "SOLID", color: {r: 0.94, g: 0.96, b: 0.98}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
U("32:19", {fills: [{type: "SOLID", color: {r: 0.11, g: 0.28, b: 0.38}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
'''
    run_batch(ops_ai14, "polish_ai14")

    # 2. AI16 (32:123): update top capsule text, expand note box & adjust button positions
    # Find child IDs in 32:150
    # Let's read 32:123 children
    ops_ai16 = '''
U("32:126", {characters: "● 待核对记账草案"})
U("32:148", {width: 270, height: 50, x: 96})
U("32:149", {width: 242})
'''
    run_batch(ops_ai16, "polish_ai16_hdr")

    # Check node IDs inside 32:150
    res = call_mcp('batch_read', {'nodeIds': ['32:123']}, 'read_ai16')
    txt = res.get('content', [{}])[0].get('text', '')
    data = json.loads(txt)
    nodes = data.get('data', {}).get('nodes', [])
    card = next((c for c in nodes[0]['children'] if c['id'] == '32:150'), None)
    if card:
        card_children = {c.get('name'): c.get('id') for c in card.get('children', [])}
        print("Card 32:150 children:", card_children)
        sec_b_id = card_children.get('核对说明栏')
        btn_ok_id = card_children.get('核对并继续按钮 (主动作)')
        btn_no_id = card_children.get('取消此草稿按钮 (次动作)')
        ops_card = f'''
U("{sec_b_id}", {{height: 62}})
U("{btn_ok_id}", {{y: 344}})
U("{btn_no_id}", {{y: 402}})
U("32:150", {{height: 516}})
'''
        run_batch(ops_card, "polish_ai16_card")

    # 3. AI17 (32:172): format clean inquiry body text and box padding
    res17 = call_mcp('batch_read', {'nodeIds': ['32:172']}, 'read_ai17')
    txt17 = res17.get('content', [{}])[0].get('text', '')
    data17 = json.loads(txt17)
    nodes17 = data17.get('data', {}).get('nodes', [])
    ai17_children = {c.get('name'): c.get('id') for c in nodes17[0].get('children', [])}
    print("AI17 children:", ai17_children)
    ai_card_id = ai17_children.get('AI查询回复卡片')
    sig_id = ai17_children.get('独立视觉信号模块 (未执行记账)')
    act_lbl_id = ai17_children.get('下一步提示标签')
    ch1_id = ai17_children.get('下一步动作1 · 查看预算详情')
    ch2_id = ai17_children.get('下一步动作2 · 继续提问')

    # Get body text node in ai_card
    ai_card_node = next((c for c in nodes17[0]['children'] if c['id'] == ai_card_id), None)
    body_node = next((c for c in ai_card_node.get('children', []) if c.get('name') == '查询回复正文'), None)

    clean_text = "[演示数据] 截至今日，本月餐饮总预算为 ¥2,000.00，已执行支出 ¥860.00，剩余可用预算 ¥1,140.00（执行率 43%）。目前进度健康，暂无超支风险。"
    ops_17 = f'''
U("{body_node['id']}", {{characters: "{clean_text}", width: 310, height: 60}})
U("{sig_id}", {{height: 86}})
U("{act_lbl_id}", {{y: 406}})
U("{ch1_id}", {{y: 432}})
U("{ch2_id}", {{y: 488}})
'''
    run_batch(ops_17, "polish_ai17")
    print("=== Polish Complete ===")


if __name__ == '__main__':
    main()
