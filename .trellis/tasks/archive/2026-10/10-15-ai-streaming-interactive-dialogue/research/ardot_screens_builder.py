"""Build Screens 2 through 5 for AI Streaming & Interactive Dialogue
- Screen 2 (AI15): 追问单选与自由输入 · 390×844 (x: 454, y: 3696)
- Screen 3 (AI16): 待确认财务卡(明确未入账) · 390×844 (x: 908, y: 3696)
- Screen 4 (AI17): 回答完成独立视觉信号 · 390×844 (x: 1362, y: 3696)
- Screen 5 (AI18): 断流重连与失败提示 · 390×844 (x: 1816, y: 3696)
"""
import json
import sys
from pathlib import Path
from ardot_builder import run_batch, call_mcp

PAGE_ID = "20:1"
Y_OFFSET = 3696

def copy_chrome(screen_id):
    """Copies status bar, battery, gesture bar, and full 4+1 bottom nav into a screen frame."""
    ops = f'''
sb=C("20:3", "{screen_id}", {{x: 24, y: 12}})
bt=C("20:4", "{screen_id}", {{x: 342, y: 10}})
hm=C("20:10", "{screen_id}", {{x: 145, y: 828}})
nv_bg=C("20:41", "{screen_id}", {{x: 0, y: 750}})
n1=C("20:42", "{screen_id}", {{x: 28, y: 758}})
n2=C("20:44", "{screen_id}", {{x: 20, y: 791}})
n3=C("20:45", "{screen_id}", {{x: 101, y: 758}})
n4=C("20:47", "{screen_id}", {{x: 93, y: 791}})
n5=C("20:48", "{screen_id}", {{x: 166, y: 744}})
n6=C("20:49", "{screen_id}", {{x: 183, y: 754}})
n7=C("20:51", "{screen_id}", {{x: 175, y: 800}})
n8=C("20:52", "{screen_id}", {{x: 257, y: 758}})
n9=C("20:54", "{screen_id}", {{x: 249, y: 791}})
n10=C("20:55", "{screen_id}", {{x: 335, y: 758}})
n11=C("20:57", "{screen_id}", {{x: 327, y: 791}})
'''
    return ops.strip()


def build_screen_2():
    print("=== Building Screen 2 (AI15): 追问单选与自由输入 ===")
    # Step 1: Base Shell
    ops_base = f'''
s2=I("{PAGE_ID}", {{type: "frame", name: "AI15 追问单选与自由输入 · 390×844", x: 454, y: {Y_OFFSET}, width: 390, height: 844, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.96, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], clipsContent: true}})
hdr=I(s2, {{type: "text", name: "标题", characters: "AI 助理", fontSize: 24, x: 24, y: 50, width: 140, height: 32}})
tag=I(s2, {{type: "frame", name: "状态指示胶囊", x: 170, y: 54, width: 120, height: 24, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 0.99, g: 0.95, b: 0.88}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.92, g: 0.64, b: 0.23}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
tag_txt=I(tag, {{type: "text", name: "状态文本", characters: "● 待确认分类追问", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 4, width: 100, height: 16}})
'''
    res = run_batch(ops_base, "screen2_01_base")
    s2_id = res["data"]["operations"][0]["node"]["id"]
    print(f"Screen 2 ID: {s2_id}")

    # Step 2: Chrome
    run_batch(copy_chrome(s2_id), "screen2_02_chrome")

    # Step 3: User message & AI Clarification Card
    # Prompt text
    prompt_json = json.dumps({
        "type": "text",
        "name": "追问标题",
        "characters": "这笔星巴克消费已识别，为了准确记账，请确认支出分类：",
        "fontSize": 14,
        "lineHeight": {"unit": "PIXELS", "value": 20},
        "fills": [{"type": "SOLID", "color": {"r": 0.09, "g": 0.17, "b": 0.30}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 16, "y": 48, "width": 310, "height": 44
    }, ensure_ascii=False)

    notice_json = json.dumps({
        "type": "text",
        "name": "安全提示文本",
        "characters": "💡 交互说明：点击下方选项仅作为对话补充输入，绝不会直接确认记账或变更账本。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 34
    }, ensure_ascii=False)

    ops_content = f'''
u_bub=I("{s2_id}", {{type: "frame", name: "用户气泡", x: 80, y: 96, width: 286, height: 60, cornerRadius: 18, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
u_t1=I(u_bub, {{type: "text", name: "用户提问", characters: "今天下午在星巴克喝拿铁花了35元，微信付的", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 14, y: 12, width: 258, height: 20}})
u_t2=I(u_bub, {{type: "text", name: "时间戳", characters: "15:30", fontSize: 10, fills: [{{type: "SOLID", color: {{r: 0.85, g: 0.92, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 245, y: 38, width: 32, height: 14}})
ai_card=I("{s2_id}", {{type: "frame", name: "AI追问卡片", x: 24, y: 172, width: 342, height: 470, cornerRadius: 20, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
pill=I(ai_card, {{type: "frame", name: "追问标识徽章", x: 16, y: 16, width: 150, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 0.99, g: 0.95, b: 0.88}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
pill_txt=I(pill, {{type: "text", name: "徽章文本", characters: "💬 分类建议 · 请选择", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 130, height: 16}})
p_txt=I(ai_card, {prompt_json})
opt1=I(ai_card, {{type: "frame", name: "选项1 (推荐) · 餐饮咖啡", x: 16, y: 102, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.93, g: 0.95, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 2}})
opt1_txt=I(opt1, {{type: "text", name: "选项1文本", characters: "☕ 餐饮美食 · 咖啡饮品", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.14, g: 0.34, b: 0.62}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 190, height: 20}})
opt1_badge=I(opt1, {{type: "frame", name: "推荐标签", x: 236, y: 13, width: 58, height: 24, cornerRadius: 6, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
opt1_btxt=I(opt1_badge, {{type: "text", name: "推荐字样", characters: "推荐", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 4, width: 30, height: 16}})
opt2=I(ai_card, {{type: "frame", name: "选项2 · 休闲下午茶", x: 16, y: 160, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt2_txt=I(opt2, {{type: "text", name: "选项2文本", characters: "🍰 休闲娱乐 · 下午茶", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
opt3=I(ai_card, {{type: "frame", name: "选项3 · 商务社交", x: 16, y: 218, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt3_txt=I(opt3, {{type: "text", name: "选项3文本", characters: "💼 商务社交 · 客户洽谈", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
opt4=I(ai_card, {{type: "frame", name: "选项4 · 工作加班餐", x: 16, y: 276, width: 310, height: 50, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
opt4_txt=I(opt4, {{type: "text", name: "选项4文本", characters: "💻 日常支出 · 加班餐饮", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 15, width: 220, height: 20}})
safe_box=I(ai_card, {{type: "frame", name: "安全说明栏", x: 16, y: 338, width: 310, height: 50, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
safe_txt=I(safe_box, {notice_json})
'''
    run_batch(ops_content, "screen2_03_content")

    # Step 4: Bottom active composer with free-text input
    ops_composer = f'''
cmp=I("{s2_id}", {{type: "frame", name: "底部输入栏 (自由输入)", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp_txt=I(cmp, {{type: "text", name: "自由输入占位符", characters: "或直接输入自定义分类 / 备注说明...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
cmp_btn=I(cmp, {{type: "frame", name: "发送动作按钮", x: 288, y: 8, width: 44, height: 40, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
cmp_btn_t=I(cmp_btn, {{type: "text", name: "发送箭头", characters: "↑", fontSize: 18, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 8, width: 16, height: 20}})
'''
    run_batch(ops_composer, "screen2_04_composer")
    return s2_id


def build_screen_3():
    print("=== Building Screen 3 (AI16): 待确认财务卡(明确未入账) ===")
    ops_base = f'''
s3=I("{PAGE_ID}", {{type: "frame", name: "AI16 待确认财务卡(明确未入账) · 390×844", x: 908, y: {Y_OFFSET}, width: 390, height: 844, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.96, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], clipsContent: true}})
hdr=I(s3, {{type: "text", name: "标题", characters: "AI 助理", fontSize: 24, x: 24, y: 50, width: 140, height: 32}})
tag=I(s3, {{type: "frame", name: "状态指示胶囊", x: 170, y: 54, width: 120, height: 24, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 1, g: 0.97, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.92, g: 0.64, b: 0.23}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
tag_txt=I(tag, {{type: "text", name: "状态文本", characters: "● 待确认记账草案", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 4, width: 100, height: 16}})
'''
    res = run_batch(ops_base, "screen3_01_base")
    s3_id = res["data"]["operations"][0]["node"]["id"]
    print(f"Screen 3 ID: {s3_id}")

    run_batch(copy_chrome(s3_id), "screen3_02_chrome")

    # Financial confirmation card
    card_banner_json = json.dumps({
        "type": "text",
        "name": "安全拦截声明",
        "characters": "🔒 财务安全确认：AI 无权自动记入账本。请核实上述消费事实，点击“确认记入账本”后方可正式生效。",
        "fontSize": 11,
        "lineHeight": {"unit": "PIXELS", "value": 16},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 10, "y": 8, "width": 290, "height": 34
    }, ensure_ascii=False)

    ops_card = f'''
u_bub=I("{s3_id}", {{type: "frame", name: "用户选择气泡", x: 130, y: 96, width: 236, height: 48, cornerRadius: 18, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
u_t1=I(u_bub, {{type: "text", name: "用户选择文本", characters: "选择：☕ 餐饮美食 · 咖啡饮品", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 14, y: 14, width: 208, height: 20}})
card=I("{s3_id}", {{type: "frame", name: "待确认记账卡片", x: 24, y: 156, width: 342, height: 500, cornerRadius: 22, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
status_pill=I(card, {{type: "frame", name: "尚未入账警示徽章", x: 16, y: 16, width: 170, height: 28, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 0.97, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.92, g: 0.64, b: 0.23}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
status_txt=I(status_pill, {{type: "text", name: "未入账文本", characters: "🟡 尚未入账 · 需手动确认", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 6, width: 150, height: 16}})
amt_lbl=I(card, {{type: "text", name: "金额标签", characters: "支出金额", fontSize: 12, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 56, width: 80, height: 16}})
amt_val=I(card, {{type: "text", name: "金额数值", characters: "-¥35.00", fontSize: 32, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 76, width: 180, height: 40}})
div1=I(card, {{type: "frame", name: "分割线", x: 16, y: 124, width: 310, height: 1, fills: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
r1_l=I(card, {{type: "text", name: "日期标签", characters: "交易时间", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 138, width: 80, height: 20}})
r1_v=I(card, {{type: "text", name: "日期数值", characters: "2026-10-15 15:30", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 160, y: 138, width: 166, height: 20}})
r2_l=I(card, {{type: "text", name: "分类标签", characters: "支出分类", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 168, width: 80, height: 20}})
r2_v=I(card, {{type: "text", name: "分类数值", characters: "餐饮美食 > 咖啡饮品", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 160, y: 168, width: 166, height: 20}})
r3_l=I(card, {{type: "text", name: "账户标签", characters: "支付账户", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 198, width: 80, height: 20}})
r3_v=I(card, {{type: "text", name: "账户数值", characters: "微信零钱", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 160, y: 198, width: 166, height: 20}})
r4_l=I(card, {{type: "text", name: "商户标签", characters: "商户 / 备注", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 228, width: 80, height: 20}})
r4_v=I(card, {{type: "text", name: "商户数值", characters: "星巴克拿铁咖啡", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 160, y: 228, width: 166, height: 20}})
sec_box=I(card, {{type: "frame", name: "安全围栏说明栏", x: 16, y: 268, width: 310, height: 50, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.98, b: 0.99}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.93, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
sec_txt=I(sec_box, {card_banner_json})
btn_ok=I(card, {{type: "frame", name: "确认入账按钮 (主动作)", x: 16, y: 332, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
btn_ok_t=I(btn_ok, {{type: "text", name: "确认文本", characters: "✓ 确认记入账本", fontSize: 15, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 95, y: 14, width: 120, height: 20}})
btn_no=I(card, {{type: "frame", name: "放弃修改按钮 (次动作)", x: 16, y: 390, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
btn_no_t=I(btn_no, {{type: "text", name: "放弃文本", characters: "✕ 放弃 / 调整信息", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 95, y: 14, width: 120, height: 20}})
'''
    run_batch(ops_card, "screen3_03_card")

    # Bottom idle composer
    ops_cmp = f'''
cmp=I("{s3_id}", {{type: "frame", name: "底部输入栏", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp_t=I(cmp, {{type: "text", name: "占位文字", characters: "核对卡片或在此输入补充指令...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
'''
    run_batch(ops_cmp, "screen3_04_cmp")
    return s3_id


def build_screen_4():
    print("=== Building Screen 4 (AI17): 回答完成独立视觉信号 ===")
    ops_base = f'''
s4=I("{PAGE_ID}", {{type: "frame", name: "AI17 回答完成独立视觉信号 · 390×844", x: 1362, y: {Y_OFFSET}, width: 390, height: 844, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.96, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], clipsContent: true}})
hdr=I(s4, {{type: "text", name: "标题", characters: "AI 助理", fontSize: 24, x: 24, y: 50, width: 140, height: 32}})
tag=I(s4, {{type: "frame", name: "状态指示胶囊", x: 170, y: 54, width: 120, height: 24, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.99, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.09, g: 0.65, b: 0.48}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
tag_txt=I(tag, {{type: "text", name: "状态文本", characters: "● 本轮已入账完成", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.05, g: 0.45, b: 0.32}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 4, width: 100, height: 16}})
'''
    res = run_batch(ops_base, "screen4_01_base")
    s4_id = res["data"]["operations"][0]["node"]["id"]
    print(f"Screen 4 ID: {s4_id}")

    run_batch(copy_chrome(s4_id), "screen4_02_chrome")

    # Success Card & Separate Answer Finished Visual Signal
    ops_content = f'''
bk_card=I("{s4_id}", {{type: "frame", name: "已入账成功凭证卡", x: 24, y: 96, width: 342, height: 130, cornerRadius: 18, fills: [{{type: "SOLID", color: {{r: 0.94, g: 0.99, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.73, g: 0.95, b: 0.82}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
bk_pill=I(bk_card, {{type: "frame", name: "入账状态徽章", x: 16, y: 14, width: 190, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 0.85, g: 0.98, b: 0.90}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
bk_pill_t=I(bk_pill, {{type: "text", name: "入账文本", characters: "🟢 账本已入账 · 凭证 #20261015-01", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.05, g: 0.45, b: 0.32}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 170, height: 16}})
bk_amt=I(bk_card, {{type: "text", name: "金额与分类", characters: "-¥35.00  餐饮美食 > 咖啡饮品", fontSize: 15, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 52, width: 280, height: 22}})
bk_acc=I(bk_card, {{type: "text", name: "扣减账户", characters: "已自动扣减 [微信零钱] 余额 · 2026-10-15 15:30", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 84, width: 290, height: 18}})
ai_msg=I("{s4_id}", {{type: "frame", name: "AI总结气泡", x: 24, y: 238, width: 342, height: 60, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
ai_msg_t=I(ai_msg, {{type: "text", name: "回复总结内容", characters: "已为您成功记录该笔支出！今日餐饮累计支出已实时更新。", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.09, g: 0.17, b: 0.30}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 20, width: 310, height: 20}})
end_sig=I("{s4_id}", {{type: "frame", name: "独立回答结束视觉信号框", x: 24, y: 310, width: 342, height: 72, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.85, g: 0.88, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
end_sig_t1=I(end_sig, {{type: "text", name: "结束信号主标题", characters: "✓ 本轮 AI 回答已全部结束", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.25, b: 0.33}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 220, height: 20}})
end_sig_t2=I(end_sig, {{type: "text", name: "结束信号说明", characters: "会话已回归待命就绪状态，您可继续追问或开启新记账", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 40, width: 300, height: 18}})
act_lbl=I("{s4_id}", {{type: "text", name: "快捷行动标签", characters: "您还可以继续：", fontSize: 12, fills: [{{type: "SOLID", color: {{r: 0.48, g: 0.53, b: 0.60}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 24, y: 396, width: 140, height: 18}})
chip1=I("{s4_id}", {{type: "frame", name: "快捷动作1 · 查看餐饮汇总", x: 24, y: 422, width: 342, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
chip1_t=I(chip1, {{type: "text", name: "动作1文本", characters: "📊 查看今日餐饮支出明细与剩余预算", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 280, height: 20}})
chip2=I("{s4_id}", {{type: "frame", name: "快捷动作2 · 再记一笔", x: 24, y: 478, width: 342, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
chip2_t=I(chip2, {{type: "text", name: "动作2文本", characters: "➕ 继续记下一笔消费", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 16, y: 14, width: 280, height: 20}})
cmp=I("{s4_id}", {{type: "frame", name: "底部就绪输入栏", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp_t=I(cmp, {{type: "text", name: "就绪输入占位", characters: "问我任何账务问题，或直接输入记账...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
'''
    run_batch(ops_content, "screen4_03_content")
    return s4_id


def build_screen_5():
    print("=== Building Screen 5 (AI18): 断流重连与失败提示 ===")
    ops_base = f'''
s5=I("{PAGE_ID}", {{type: "frame", name: "AI18 断流重连与失败提示 · 390×844", x: 1816, y: {Y_OFFSET}, width: 390, height: 844, fills: [{{type: "SOLID", color: {{r: 0.97, g: 0.96, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], clipsContent: true}})
hdr=I(s5, {{type: "text", name: "标题", characters: "AI 助理", fontSize: 24, x: 24, y: 50, width: 140, height: 32}})
tag=I(s5, {{type: "frame", name: "状态指示胶囊", x: 170, y: 54, width: 120, height: 24, cornerRadius: 12, fills: [{{type: "SOLID", color: {{r: 1, g: 0.92, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.91, g: 0.36, b: 0.40}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
tag_txt=I(tag, {{type: "text", name: "状态文本", characters: "● 连接中断 / 未完成", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.78, g: 0.15, b: 0.20}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 4, width: 100, height: 16}})
'''
    res = run_batch(ops_base, "screen5_01_base")
    s5_id = res["data"]["operations"][0]["node"]["id"]
    print(f"Screen 5 ID: {s5_id}")

    run_batch(copy_chrome(s5_id), "screen5_02_chrome")

    # Interrupted partial text and graceful recovery box
    partial_text_json = json.dumps({
        "type": "text",
        "name": "已保留的截断片段",
        "characters": "收到，已梳理消费事实：\n• 金额：35.00 元\n• 商家：星巴克咖啡\n• 支付：微信零钱\n\n[流式连接于 15:30:12 中断，已停止接收]",
        "fontSize": 13,
        "lineHeight": {"unit": "PIXELS", "value": 18},
        "fills": [{"type": "SOLID", "color": {"r": 0.48, "g": 0.53, "b": 0.60}, "opacity": 1, "visible": True, "blendMode": "NORMAL"}],
        "x": 16, "y": 52, "width": 310, "height": 90
    }, ensure_ascii=False)

    ops_interrupted = f'''
u_bub=I("{s5_id}", {{type: "frame", name: "用户气泡", x: 80, y: 96, width: 286, height: 60, cornerRadius: 18, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
u_t1=I(u_bub, {{type: "text", name: "用户提问", characters: "今天下午在星巴克喝拿铁花了35元，微信付的", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 14, y: 12, width: 258, height: 20}})
u_t2=I(u_bub, {{type: "text", name: "时间戳", characters: "15:30", fontSize: 10, fills: [{{type: "SOLID", color: {{r: 0.85, g: 0.92, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 245, y: 38, width: 32, height: 14}})
err_card=I("{s5_id}", {{type: "frame", name: "异常与断流卡片", x: 24, y: 172, width: 342, height: 460, cornerRadius: 20, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.98, g: 0.65, b: 0.65}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
err_pill=I(err_card, {{type: "frame", name: "断流警示徽章", x: 16, y: 16, width: 170, height: 26, cornerRadius: 13, fills: [{{type: "SOLID", color: {{r: 1, g: 0.92, b: 0.92}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
err_pill_t=I(err_pill, {{type: "text", name: "徽章文本", characters: "⚠️ 流式中断 · 回复未完成", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.78, g: 0.15, b: 0.20}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 5, width: 150, height: 16}})
p_txt=I(err_card, {partial_text_json})
warn_box=I(err_card, {{type: "frame", name: "安全无害声明栏", x: 16, y: 150, width: 310, height: 60, cornerRadius: 10, fills: [{{type: "SOLID", color: {{r: 1, g: 0.98, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.98, g: 0.88, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
warn_t1=I(warn_box, {{type: "text", name: "安全说明文本", characters: "🛡️ 状态保证：传输异常中断，已自动保全已接收事实，未触发任何账本写入，资产数据完全安全。", fontSize: 11, fills: [{{type: "SOLID", color: {{r: 0.72, g: 0.45, b: 0.05}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 10, y: 12, width: 290, height: 36}})
btn_retry=I(err_card, {{type: "frame", name: "重试按钮 (主动作)", x: 16, y: 228, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.20, g: 0.47, b: 0.96}}, opacity: 1, visible: true, blendMode: "NORMAL"}}]}})
btn_retry_t=I(btn_retry, {{type: "text", name: "重试文本", characters: "🔄 恢复连接并重试回答", fontSize: 15, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 80, y: 14, width: 160, height: 20}})
btn_manual=I(err_card, {{type: "frame", name: "转手动记账 (次动作)", x: 16, y: 286, width: 310, height: 48, cornerRadius: 14, fills: [{{type: "SOLID", color: {{r: 0.95, g: 0.96, b: 0.98}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
btn_manual_t=I(btn_manual, {{type: "text", name: "手动文本", characters: "✏️ 放弃 AI，直接转去手动记一笔", fontSize: 14, fills: [{{type: "SOLID", color: {{r: 0.28, g: 0.33, b: 0.41}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 50, y: 14, width: 220, height: 20}})
cmp=I("{s5_id}", {{type: "frame", name: "底部重试输入栏", x: 24, y: 672, width: 342, height: 56, cornerRadius: 16, fills: [{{type: "SOLID", color: {{r: 1, g: 1, b: 1}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokes: [{{type: "SOLID", color: {{r: 0.89, g: 0.91, b: 0.94}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], strokeWeight: 1}})
cmp_t=I(cmp, {{type: "text", name: "输入占位", characters: "可点击上方重试，或在此重新提问...", fontSize: 13, fills: [{{type: "SOLID", color: {{r: 0.60, g: 0.65, b: 0.72}}, opacity: 1, visible: true, blendMode: "NORMAL"}}], x: 18, y: 18, width: 250, height: 20}})
'''
    run_batch(ops_interrupted, "screen5_03_content")
    return s5_id


if __name__ == '__main__':
    s2 = build_screen_2()
    s3 = build_screen_3()
    s4 = build_screen_4()
    s5 = build_screen_5()
    print("All screens built successfully!")
    print(f"Screen IDs: Screen 2={s2}, Screen 3={s3}, Screen 4={s4}, Screen 5={s5}")
