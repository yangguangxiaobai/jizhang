"""Update 5 AI Demo Screens in Ardot with Corrected Semantics
1. AI17 (32:172): Non-booking inquiry finished example; remove voucher/deductions;
   add '回答已结束 · 本轮未执行记账'; keep grounded next steps.
2. AI18 (32:214): '连接中断，正在核对服务端状态；已收到片段不是最终结果';
   primary action '重新连接并核对状态' (same generationId, no blind model replay);
   delete timestamp or mark synthetic; secondary action '返回对话' (no manual booking).
3. AI16 (32:123): primary '核对并继续' (enters 2nd confirmation); secondary '取消此草稿';
   restrained wording, no '绝对安全/CWE/免责声明', demo data tags.
4. Global: Titanium Blue #2F6F8F across all 5 screens, no emoji as icons.
"""
import json
import urllib.request
from pathlib import Path

FILE_URL = 'cocraft://localhost/file/729347012405452'
EVIDENCE_DIR = Path(__file__).parent / 'ardot-evidence'
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
MCP_ENDPOINT = 'http://127.0.0.1:50501/api/v1/mcp'

# Color constants
TITANIUM_BLUE = {"r": 0.1843137, "g": 0.4352941, "b": 0.5607843} # #2F6F8F
TITANIUM_BLUE_DARK = {"r": 0.11, "g": 0.28, "b": 0.38}
TITANIUM_BLUE_LIGHT = {"r": 0.94, "g": 0.96, "b": 0.98}
TITANIUM_BLUE_STROKE = {"r": 0.68, "g": 0.78, "b": 0.85}

WHITE = {"r": 1.0, "g": 1.0, "b": 1.0}
DARK_TEXT = {"r": 0.09, "g": 0.17, "b": 0.30}
BODY_TEXT = {"r": 0.22, "g": 0.28, "b": 0.36}
MUTED_TEXT = {"r": 0.48, "g": 0.53, "b": 0.60}
LIGHT_BG = {"r": 0.97, "g": 0.96, "b": 0.94}
CARD_STROKE = {"r": 0.89, "g": 0.91, "b": 0.94}
NEUTRAL_BTN_FILL = {"r": 0.95, "g": 0.96, "b": 0.98}
NEUTRAL_BTN_STROKE = {"r": 0.88, "g": 0.90, "b": 0.93}


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


def update_screen_1_ai14():
    print("\n=== Updating Screen 1 (AI14, 32:11) ===")
    # 1. Update user bubble to Titanium Blue #2F6F8F
    # 2. Update status text and AI card children
    ops1 = '''
U("32:20", {fills: [{type: "SOLID", color: {r: 0.1843, g: 0.4353, b: 0.5608}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
U("32:21", {characters: "[演示数据] 今天下午在星巴克喝拿铁花了35元，微信付的"})
D("32:24")
D("32:26")
D("32:27")
D("32:29")
D("32:33")
'''
    run_batch(ops1, "s1_clean_card")

    t_snippet = json.dumps({
        "type": "text",
        "name": "流式增量文本",
        "characters": "[演示数据] 已识别消费意图：\n• 金额：¥35.00\n• 商户：星巴克咖啡\n• 支付方式：微信支付\n正在核对支出分类与预算归属...",
        "fontSize": 13,
        "lineHeight": {"unit": "PIXELS", "value": 20},
        "fills": [{"type": "SOLID", "color": {"r": 0.09, "g": 0.17, "b": 0.30}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 16, "y": 64, "width": 310, "height": 90
    }, ensure_ascii=False)

    t_notice = json.dumps({
        "type": "text",
        "name": "说明文本",
        "characters": "说明：流式生成过程中不向账本写入任何记录，生成完毕后需手动核对。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 34
    }, ensure_ascii=False)

    ops2 = f'''
p1=I("32:23", {{type: "frame", name: "流式标识胶囊", x: 16, y: 16, width: 170, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
p1_t=I(p1, {{type: "text", name: "胶囊文字", characters: "● 流式生成中 · 结构化草案", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 150, height: 16}})
bar=I("32:23", {{type: "frame", name: "流式指示条", x: 16, y: 50, width: 310, height: 3, cornerRadius: 2, fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
snip=I("32:23", {t_snippet})
box=I("32:23", {{type: "frame", name: "生成提示栏", x: 16, y: 164, width: 310, height: 48, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
box_t=I(box, {t_notice})
s_btn=I("32:23", {{type: "frame", name: "停止生成按钮", x: 16, y: 224, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.99, g: 0.93, b: 0.93}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.98, g: 0.70, b: 0.70}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
s_btnt=I(s_btn, {{type: "text", name: "停止文本", characters: "停止生成 (保留已输出片段)", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.11, b: 0.11}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 65, y: 14, width: 180, height: 20}})
U("32:23", {{height: 290}})
'''
    run_batch(ops2, "s1_insert_card")


def update_screen_2_ai15():
    print("\n=== Updating Screen 2 (AI15, 32:75) ===")
    ops1 = '''
U("32:100", {fills: [{type: "SOLID", color: {r: 0.1843, g: 0.4353, b: 0.5608}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
U("32:101", {characters: "[演示数据] 今天下午在星巴克喝拿铁花了35元，微信付的"})
D("32:104")
D("32:106")
D("32:107")
D("32:111")
D("32:113")
D("32:115")
D("32:117")
'''
    run_batch(ops1, "s2_clean_card")

    prompt_json = json.dumps({
        "type": "text",
        "name": "追问标题",
        "characters": "[演示数据] 这笔星巴克消费已识别，为了准确记账，请确认支出分类：",
        "fontSize": 14,
        "lineHeight": {"unit": "PIXELS", "value": 20},
        "fills": [{"type": "SOLID", "color": {"r": 0.09, "g": 0.17, "b": 0.30}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 16, "y": 48, "width": 310, "height": 44
    }, ensure_ascii=False)

    notice_json = json.dumps({
        "type": "text",
        "name": "说明文本",
        "characters": "说明：点击选项仅作为对话补充输入，不会直接记入账本。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 34
    }, ensure_ascii=False)

    ops2 = f'''
p2=I("32:103", {{type: "frame", name: "追问标识徽章", x: 16, y: 16, width: 140, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
p2_t=I(p2, {{type: "text", name: "徽章文本", characters: "● 待确认分类 · 请选择", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 120, height: 16}})
p2_txt=I("32:103", {prompt_json})
opt1=I("32:103", {{type: "frame", name: "选项1 (推荐) · 餐饮咖啡", x: 16, y: 102, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 2}})
opt1_t=I(opt1, {{type: "text", name: "选项1文本", characters: "餐饮美食 · 咖啡饮品", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 180, height: 20}})
opt1_b=I(opt1, {{type: "frame", name: "推荐徽章", x: 236, y: 13, width: 58, height: 24, cornerRadius: 6, fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
opt1_bt=I(opt1_b, {{type: "text", name: "推荐字样", characters: "推荐", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 4, width: 30, height: 16}})
opt2=I("32:103", {{type: "frame", name: "选项2 · 休闲下午茶", x: 16, y: 160, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt2_t=I(opt2, {{type: "text", name: "选项2文本", characters: "休闲娱乐 · 下午茶", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
opt3=I("32:103", {{type: "frame", name: "选项3 · 商务社交", x: 16, y: 218, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt3_t=I(opt3, {{type: "text", name: "选项3文本", characters: "商务社交 · 客户洽谈", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
opt4=I("32:103", {{type: "frame", name: "选项4 · 工作加班餐", x: 16, y: 276, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt4_t=I(opt4, {{type: "text", name: "选项4文本", characters: "日常支出 · 加班餐饮", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
safe=I("32:103", {{type: "frame", name: "安全说明栏", x: 16, y: 338, width: 310, height: 50, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
safe_t=I(safe, {notice_json})
U("32:121", {{fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
'''
    run_batch(ops2, "s2_insert_card")


def update_screen_3_ai16():
    print("\n=== Updating Screen 3 (AI16, 32:123) ===")
    # Primary button: "核对并继续", Secondary: "取消此草稿"
    # Explain: 进入独立二次确认流程
    # No emoji as icons, Titanium blue #2F6F8F
    ops1 = '''
U("32:148", {fills: [{type: "SOLID", color: {r: 0.1843, g: 0.4353, b: 0.5608}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
U("32:149", {characters: "[演示数据] 选择：餐饮美食 · 咖啡饮品"})
D("32:151")
D("32:153")
D("32:154")
D("32:155")
D("32:156")
D("32:157")
D("32:158")
D("32:159")
D("32:160")
D("32:161")
D("32:162")
D("32:163")
D("32:164")
D("32:166")
D("32:168")
'''
    run_batch(ops1, "s3_clean_card")

    card_note_json = json.dumps({
        "type": "text",
        "name": "核对流程说明",
        "characters": "说明：点击“核对并继续”将进入独立二次确认流程，核对要素无误后正式记入账本。当前仅为生成草案，未发生记账。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 34
    }, ensure_ascii=False)

    ops2 = f'''
st_pill=I("32:150", {{type: "frame", name: "未入账状态徽章", x: 16, y: 16, width: 170, height: 28, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 0.97, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.92, g: 0.64, b: 0.23}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
st_txt=I(st_pill, {{type: "text", name: "未入账文本", characters: "● 待核对草案 · 尚未入账", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 6, width: 150, height: 16}})
amt_l=I("32:150", {{type: "text", name: "金额标签", characters: "支出金额 [演示数据]", fontSize: 12, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 56, width: 140, height: 16}})
amt_v=I("32:150", {{type: "text", name: "金额数值", characters: "-¥35.00", fontSize: 32, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 76, width: 180, height: 40}})
div=I("32:150", {{type: "frame", name: "分割线", x: 16, y: 124, width: 310, height: 1, fills: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
r1_l=I("32:150", {{type: "text", name: "日期标签", characters: "交易时间", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 138, width: 80, height: 20}})
r1_v=I("32:150", {{type: "text", name: "日期数值", characters: "2026-10-15 15:30 [演示]", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 140, y: 138, width: 186, height: 20}})
r2_l=I("32:150", {{type: "text", name: "分类标签", characters: "支出分类", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 168, width: 80, height: 20}})
r2_v=I("32:150", {{type: "text", name: "分类数值", characters: "餐饮美食 > 咖啡饮品", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 140, y: 168, width: 186, height: 20}})
r3_l=I("32:150", {{type: "text", name: "账户标签", characters: "支付账户", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 198, width: 80, height: 20}})
r3_v=I("32:150", {{type: "text", name: "账户数值", characters: "微信零钱", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 140, y: 198, width: 186, height: 20}})
r4_l=I("32:150", {{type: "text", name: "商户标签", characters: "商户 / 备注", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 228, width: 80, height: 20}})
r4_v=I("32:150", {{type: "text", name: "商户数值", characters: "星巴克拿铁咖啡", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 140, y: 228, width: 186, height: 20}})
sec_b=I("32:150", {{type: "frame", name: "核对说明栏", x: 16, y: 268, width: 310, height: 50, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
sec_t=I(sec_b, {card_note_json})
btn_ok=I("32:150", {{type: "frame", name: "核对并继续按钮 (主动作)", x: 16, y: 332, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
btn_ok_t=I(btn_ok, {{type: "text", name: "核对继续文本", characters: "核对并继续 →", fontSize: 15, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 105, y: 14, width: 110, height: 20}})
btn_no=I("32:150", {{type: "frame", name: "取消此草稿按钮 (次动作)", x: 16, y: 390, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
btn_no_t=I(btn_no, {{type: "text", name: "取消文本", characters: "取消此草稿", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 115, y: 14, width: 90, height: 20}})
'''
    run_batch(ops2, "s3_insert_card")


def update_screen_4_ai17():
    print("\n=== Updating Screen 4 (AI17, 32:172) ===")
    # Requirement:
    # 1. 展示普通回答已结束的独立示例而不是“账本已入账·凭证#...”与余额预算扣减。
    # 2. 删掉虚构凭证/已扣减，改“回答已结束 · 本轮未执行记账”。
    # 3. 保留非财务查询示例及明确下一步；图中不要引入未落地新action能力。
    ops1 = '''
D("32:197")
D("32:202")
D("32:204")
D("32:207")
D("32:208")
D("32:210")
D("32:212")
U("32:174", {fills: [{type: "SOLID", color: {r: 0.94, g: 0.96, b: 0.98}, opacity: 1, visible: true, blendMode: "NORMAL"}], strokes: [{type: "SOLID", color: {r: 0.1843, g: 0.4353, b: 0.5608}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
U("32:175", {characters: "● 回答已结束", fills: [{type: "SOLID", color: {r: 0.11, g: 0.28, b: 0.38}, opacity: 1, visible: true, blendMode: "NORMAL"}]})
'''
    run_batch(ops1, "s4_clean_content")

    # Re-insert into 32:172:
    # 1. User inquiry bubble: Non-booking financial query
    # 2. AI inquiry answer card
    # 3. Distinct visual signal module: "回答已结束 · 本轮未执行记账"
    # 4. Next steps chips (grounded: "查看预算详情", "继续提问")
    # 5. Ready composer
    ai_inquiry_body = json.dumps({
        "type": "text",
        "name": "查询回复正文",
        "characters": "[演示数据] 截至今日，本月餐饮预算上限为 ¥2,000.00，已执行支出 ¥860.00，剩余可用预算 ¥1,140.00（预算执行率 43%）。目前进度健康，暂无超支风险。",
        "fontSize": 13,
        "lineHeight": {"unit": "PIXELS", "value": 20},
        "fills": [{"type": "SOLID", "color": {"r": 0.09, "g": 0.17, "b": 0.30}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 16, "y": 50, "width": 310, "height": 64
    }, ensure_ascii=False)

    ops2 = f'''
u_b4=I("32:172", {{type: "frame", name: "用户提问气泡", x: 74, y: 96, width: 292, height: 52, cornerRadius: 18, fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
u_t4=I(u_b4, {{type: "text", name: "提问文本", characters: "[演示数据] 本月餐饮预算目前执行情况如何？", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 14, y: 16, width: 264, height: 20}})
ai_c4=I("32:172", {{type: "frame", name: "AI查询回复卡片", x: 24, y: 160, width: 342, height: 132, cornerRadius: 20, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
ai_p4=I(ai_c4, {{type: "frame", name: "查询类别标签", x: 16, y: 16, width: 140, height: 24, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
ai_pt4=I(ai_p4, {{type: "text", name: "标签文字", characters: "餐饮预算执行查询", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 4, width: 120, height: 16}})
ai_b4=I(ai_c4, {ai_inquiry_body})
sig=I("32:172", {{type: "frame", name: "独立视觉信号模块 (未执行记账)", x: 24, y: 304, width: 342, height: 80, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.85, g: 0.88, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
sig_t1=I(sig, {{type: "text", name: "信号主标题", characters: "✓ 回答已结束 · 本轮未执行记账", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 260, height: 20}})
sig_t2=I(sig, {{type: "text", name: "信号说明", characters: "会话已回归待命就绪状态。本轮仅提供信息解答，未向账本写入任何记录。", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 40, width: 310, height: 24}})
act_lbl=I("32:172", {{type: "text", name: "下一步提示标签", characters: "您还可以继续：", fontSize: 12, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 24, y: 398, width: 140, height: 18}})
ch1=I("32:172", {{type: "frame", name: "下一步动作1 · 查看预算详情", x: 24, y: 424, width: 342, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
ch1_t=I(ch1, {{type: "text", name: "动作1文本", characters: "查看预算详情与月度收支", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.11, g: 0.28, b: 0.38}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 280, height: 20}})
ch2=I("32:172", {{type: "frame", name: "下一步动作2 · 继续提问", x: 24, y: 480, width: 342, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
ch2_t=I(ch2, {{type: "text", name: "动作2文本", characters: "继续提问其他账务或发起记账", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 280, height: 20}})
cmp4=I("32:172", {{type: "frame", name: "底部就绪输入栏", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp4_t=I(cmp4, {{type: "text", name: "就绪输入占位", characters: "输入账务问题或记账指令...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
'''
    run_batch(ops2, "s4_insert_content")


def update_screen_5_ai18():
    print("\n=== Updating Screen 5 (AI18, 32:214) ===")
    snip_json = json.dumps({
        "type": "text",
        "name": "已收片段内容",
        "characters": "[演示数据片段 · 流式已暂停]\n识别到消费事实：金额 ¥35.00，商户 星巴克咖啡...",
        "fontSize": 12,
        "lineHeight": {"unit": "PIXELS", "value": 18},
        "fills": [{"type": "SOLID", "color": {"r": 0.28, "g": 0.33, "b": 0.41}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 12, "y": 10, "width": 286, "height": 38
    }, ensure_ascii=False)

    warn_json = json.dumps({
        "type": "text",
        "name": "中断提示文本",
        "characters": "连接中断，正在核对服务端状态；已收到片段不是最终结果",
        "fontSize": 12,
        "lineHeight": {"unit": "PIXELS", "value": 18},
        "fills": [{"type": "SOLID", "color": {"r": 0.72, "g": 0.11, "b": 0.11}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 12, "y": 10, "width": 286, "height": 38
    }, ensure_ascii=False)

    note_json = json.dumps({
        "type": "text",
        "name": "恢复机制说明",
        "characters": "说明：系统将尝试恢复同 generation 会话状态，不会重复调用模型。只有服务端明确返回终态失败后，方可显式重新生成。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 48
    }, ensure_ascii=False)

    ops2 = f'''
c5=I("32:214", {{type: "frame", name: "连接中断核对卡片", x: 24, y: 172, width: 342, height: 400, cornerRadius: 20, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
p5=I(c5, {{type: "frame", name: "中断状态徽章", x: 16, y: 16, width: 150, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 0.94, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.95, g: 0.55, b: 0.55}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
p5_t=I(p5, {{type: "text", name: "徽章文本", characters: "● 连接中断 · 正在核对", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.11, b: 0.11}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 130, height: 16}})
snip_b=I(c5, {{type: "frame", name: "已收片段框", x: 16, y: 52, width: 310, height: 58, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
snip_t=I(snip_b, {snip_json})
warn_b=I(c5, {{type: "frame", name: "中断警告提示框", x: 16, y: 120, width: 310, height: 58, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 1, g: 0.96, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.98, g: 0.75, b: 0.75}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
warn_t=I(warn_b, {warn_json})
note_b=I(c5, {{type: "frame", name: "恢复机制说明框", x: 16, y: 188, width: 310, height: 64, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
note_t=I(note_b, {note_json})
btn_rec=I(c5, {{type: "frame", name: "重新连接并核对状态按钮 (主动作)", x: 16, y: 268, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.1843, g: 0.4353, b: 0.5608}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
btn_rec_t=I(btn_rec, {{type: "text", name: "重连文本", characters: "重新连接并核对状态", fontSize: 15, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 85, y: 14, width: 150, height: 20}})
btn_ret=I(c5, {{type: "frame", name: "返回对话按钮 (次动作)", x: 16, y: 326, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
btn_ret_t=I(btn_ret, {{type: "text", name: "返回文本", characters: "返回对话", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 125, y: 14, width: 70, height: 20}})
cmp5=I("32:214", {{type: "frame", name: "底部状态输入栏", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 0.96, g: 0.97, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp5_t=I(cmp5, {{type: "text", name: "核对中占位", characters: "正在核对服务端状态，暂不支持输入...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
'''
    run_batch(ops2, "s5_insert_card")


def main():
    print("=== Starting Semantics Correction for 5 Ardot Frames ===")
    update_screen_5_ai18()
    print("=== Screen 5 updated successfully! ===")


if __name__ == '__main__':
    main()
