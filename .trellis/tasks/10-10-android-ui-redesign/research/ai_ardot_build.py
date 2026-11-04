"""Reproducible editable Ardot design; only targets page20:1. Synthetic data."""
import json
from pathlib import Path
from ardot_rpc import call
ROOT=Path(__file__).parent
BG='#F7F5F0'; HERO='#244D60'; ACC='#2F6F8F'; MUT='#748087'; INK='#233B46'
serial=0
screens={}
def data(r):
    for c in r.get('content',[]):
        if c.get('type')=='text':
            d=json.loads(c['text'])
            if not d.get('success',True): raise RuntimeError(d)
            return d.get('data',d)
    raise RuntimeError(r)
def submit(ops,label):
    global serial
    for start in range(0,len(ops),25):
        serial+=1
        lines=[f'n{serial}_{i}=I({json.dumps(parent)}, {json.dumps(node,ensure_ascii=False)})' for i,(parent,node) in enumerate(ops[start:start+25])]
        out=data(call('batch_edit',{'operations':'\n'.join(lines)},f'ai-{label}-batch{serial:02}'))
        if out.get('potentialIssues'): print(out['potentialIssues'])
def rect(p,n,x,y,w,h,fill='#FFFFFF',r=16):
    return (p,dict(type='frame',name=n,x=x,y=y,width=w,height=h,fill=fill,cornerRadius=r))
def txt(p,n,t,x,y,w=342,size=14,color=INK,style='Regular',h=None):
    d=dict(type='text',name=n,content=t,x=x,y=y,width=w,fontSize=size,fill=color,fontName={'family':'Noto Sans SC','style':style},textAutoResize='HEIGHT')
    if h: d['height']=h
    return(p,d)
def icon(p,n,x,y,path,color=ACC):
    svg=f'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="{path}" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    return(p,dict(type='frame',name=n,x=x,y=y,width=24,height=24,svg=svg))
def button(p,n,t,x,y,w=342,fill=ACC,color='#FFFFFF'):
    return [rect(p,n,x,y,w,48,fill,14),txt(p,n+'文字',t,x+14,y+13,w-28,14,color,'Medium')]
def create(key,title,index):
    if key=='empty': id='20:2'
    else:
        ops=f'root{index}=I("20:1", '+json.dumps(dict(type='frame',name=title,x=(index%4)*454,y=(index//4)*924,width=390,height=844,fill=BG,clipsContent=True),ensure_ascii=False)+')'
        d=data(call('batch_edit',{'operations':ops},'ai-root-'+key)); id=d['operations'][0]['node']['id']
    screens[key]={'id':id,'title':title}
    return id
def base(p,title,sub=False):
    o=[txt(p,'系统状态栏','9:41',24,12,80,13,INK,'Medium'),icon(p,'电池轮廓',342,10,'M2 6h17v12H2z M21 10v4 M5 9h11v6H5z',INK)]
    if sub:
        o += [icon(p,'返回对话',20,55,'M15 4L7 12l8 8'),txt(p,'页面标题',title,58,52,280,22,INK,'Bold')]
    else:
        o += [txt(p,'主页面标题',title,24,50,230,26,INK,'Bold'),rect(p,'会话入口触控区',304,46,62,44,'#FFFFFF',14),icon(p,'会话历史矢量',323,56,'M4 4h16v13H9l-5 4z M8 8h8 M8 12h6')]
    o += [rect(p,'系统手势条',145,828,100,4,INK,2)]
    return o
def nav(p):
    o=[rect(p,'4+1 底部导航',0,750,390,70,'#FFFFFF',0)]
    entries=[('首页',28,'M3 11l9-8 9 8 M6 10v11h12V10'),('账单',101,'M6 3h12v18H6z M9 8h6 M9 12h6'),('记一笔',183,'M12 5v14 M5 12h14'),('AI助理',257,'M4 4h16v13H9l-5 4z'),('我的',335,'M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M4 21a8 8 0 0 1 16 0')]
    for t,x,path in entries:
        if t=='记一笔': o.append(rect(p,'居中记账动作',166,744,56,56,HERO,28))
        o += [icon(p,'导航矢量 '+t,x,758 if t!='记一笔' else 754,path,'#FFFFFF' if t=='记一笔' else ACC if t=='AI助理' else MUT),txt(p,'导航标签 '+t,t,x-8,791,64,11,ACC if t=='AI助理' else MUT,'Medium')]
    return o
def composer(p,y=672,attachment=False):
    o=[]
    if attachment:
        o += [rect(p,'合成附件信息',24,y-56,342,46,'#FFFFFF',12),txt(p,'合成文件名','演示账单.csv · 18 KB',40,y-44,270,13),icon(p,'移除附件',330,y-45,'M6 6l12 12 M18 6L6 18')]
    o += [rect(p,'消息输入容器',24,y,342,60,'#FFFFFF',18),icon(p,'选择文件',37,y+18,'M8 12l7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3 M6 16l10-10'),txt(p,'输入占位','问问账本，或上传账单…',72,y+20,230,13,MUT),rect(p,'发送触控区',318,y+8,40,44,ACC,12),icon(p,'发送矢量',326,y+18,'M12 20V4 M5 11l7-7 7 7','#FFFFFF')]
    return o
def rows(p,start=318,count=3):
    o=[]
    samples=[('云朵咖啡','2026-10-08 · 支出','¥ 28.00','餐饮','已选择'),('示例公交','2026-10-08 · 支出','¥ 2.00','交通','已选择'),('演示书店','2026-10-07 · 支出','¥ 45.00','学习','疑似重复 · 未选')]
    for i in range(count):
        y=start+i*118; merchant,date,amt,cat,status=samples[i%3]
        o += [rect(p,f'预览行 {i+1}',24,y,342,106),rect(p,f'选择框 {i+1}',38,y+18,20,20,ACC if i<2 else '#E7EAEB',5)]
        if i<2:o.append(icon(p,f'选中勾 {i+1}',36,y+16,'M5 12l4 4L19 6','#FFFFFF'))
        o += [txt(p,f'商户 {i+1}',merchant,72,y+12,174,15,INK,'Medium'),txt(p,f'金额 {i+1}',amt,263,y+12,90,15,INK,'Medium'),txt(p,f'日期 {i+1}',date,72,y+36,260,12,MUT),rect(p,f'分类覆盖字段 {i+1}',72,y+62,136,30,'#F1F5F6',8),txt(p,f'分类值 {i+1}','分类：'+cat,82,y+66,122,12,ACC),txt(p,f'行状态 {i+1}',status,219,y+69,137,10,MUT)]
    return o
def importtop(p,truncated=False):
    o=base(p,'导入预览',True)
    o += [rect(p,'导入来源摘要',24,104,342,82,HERO),txt(p,'合成文件名','演示账单.csv',40,116,310,17,'#FFFFFF','Medium'),txt(p,'边界摘要','前 200 行预览 · 每次最多选 100 条' if truncated else '预览 12 行 · 每次最多选 100 条',40,148,310,12,'#E0EAF0')]
    o += [rect(p,'本地搜索',24,202,342,46),icon(p,'搜索图标',38,214,'M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6'),txt(p,'搜索占位','搜索当前预览的商户、分类',72,216,278,13,MUT)]
    for x,w,t,on in [(24,96,'全部 12',True),(128,108,'可导入 10',False),(244,122,'疑似重复 2',False)]:
        o += [rect(p,'筛选 '+t,x,260,w,34,ACC if on else '#FFFFFF',17),txt(p,'筛选文字 '+t,t,x+12,268,w-20,12,'#FFFFFF' if on else MUT)]
    return o
def footer(p,selected='2',busy=False):
    return [rect(p,'固定选择及操作栏',0,720,390,106,'#FFFFFF',0),txt(p,'固定选择数量',f'已选 {selected} / 100 条',24,732,190,14,INK,'Medium'),txt(p,'选择范围说明','仅当前预览 · 空选择不提交',210,735,165,10,MUT)]+button(p,'确认入口' if not busy else '提交锁定','继续核对' if not busy else '提交中 · 请勿重复操作',24,764,342,ACC if not busy else '#748087')

def build():
    p=create('empty','AI01 空对话 · 390×844',0)
    o=base(p,'AI 助理')+[txt(p,'连接状态','已配置 · 账务变更需要确认',24,90,342,12,MUT),rect(p,'欢迎 Hero',24,145,342,200,HERO,24),icon(p,'欢迎星芒',43,168,'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z','#FFFFFF'),txt(p,'欢迎标题','让账本，\n更好懂一点。',44,210,300,28,'#FFFFFF','Bold'),txt(p,'欢迎说明','查询直接回答，写入先核对再确认。',44,306,304,12,'#DDE8EC'),txt(p,'快捷提示标题','从一个问题开始',24,379,342,16,INK,'Medium')]
    for i,t in enumerate(['本月花在哪里？','看看预算还剩多少','最近有哪些待确认？','帮我理解这份账单']):
        y=415+i*48;o += [rect(p,'快捷草稿 '+str(i+1),24,y,342,40),txt(p,'快捷文字 '+str(i+1),t,40,y+10,282,13),icon(p,'快捷箭头 '+str(i+1),331,y+8,'M9 5l7 7-7 7')]
    submit(o+composer(p)+nav(p),'empty')
    p=create('chat','AI02 对话与紧凑工具卡 · 390×844',1)
    o=base(p,'AI 助理')+[txt(p,'当前会话','演示账单整理 · 会话管理',24,90,342,12,MUT),rect(p,'用户消息',92,136,274,78,'#E3EDF1',18),txt(p,'合成用户文字','请帮我整理这份账单，\n先看看哪些可以导入。',108,149,242,14),rect(p,'助手回复',24,242,326,85),txt(p,'助手说明','已生成预览，还没有写入账本。\n请逐条核对金额、重复提示和分类。',40,261,290,14),rect(p,'紧凑待确认工具卡',24,347,342,205),txt(p,'工具类型','待确认 / 账单导入',42,365,308,12,ACC,'Medium'),txt(p,'工具卡标题','12 行预览，10 条可导入',42,391,308,19,INK,'Bold'),txt(p,'工具卡边界','每次最多选 100 条 · 原件核对后提交\n疑似重复默认不选；分类修改可能新建分类。',42,427,308,12,MUT)]+button(p,'打开全屏预览','查看并选择账单',40,486,310)+[txt(p,'禁止聊天内长表','详细列表在全屏预览中处理。',24,576,342,12,MUT)]
    submit(o+composer(p,attachment=True)+nav(p),'chat')
    p=create('import','AI03 全屏导入与分类 · 390×844',2)
    submit(importtop(p)+rows(p)+[txt(p,'分类副作用说明','分类为文字覆盖，可能新建或恢复同名分类。',24,683,342,11,MUT)]+footer(p),'import')
    p=create('sessions','AI04 独立会话管理 · 390×844',3)
    o=base(p,'会话管理',True)+button(p,'新建会话','新建对话',24,108)+[txt(p,'会话列表标题','最近对话',24,183,342,14,MUT,'Medium')]
    for i,(title,time) in enumerate([('演示账单整理','当前 · 10月10日'),('预算问答示例','10月09日'),('支出分类练习','10月08日')]):
        y=216+i*106;o += [rect(p,'会话行 '+str(i+1),24,y,342,88),txt(p,'会话标题 '+str(i+1),title,40,y+16,240,16,INK,'Medium'),txt(p,'会话时间 '+str(i+1),time,40,y+47,240,12,MUT),txt(p,'归档入口 '+str(i+1),'归档',307,y+29,48,12,ACC)]
    o += [rect(p,'归档边界说明',24,565,342,110,'#E9EFF1'),txt(p,'归档提示','归档前需再次确认。\n归档不会删除账本，当前没有恢复入口。\n发送或执行操作时，不开放归档。',40,585,310,13,MUT)]
    submit(o,'sessions')
    p=create('upload','AI05 单附件就绪 · 390×844',4)
    o=base(p,'AI 助理')+[rect(p,'附件引导',24,148,342,230,HERO,24),icon(p,'文档图标',45,172,'M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6','#FFFFFF'),txt(p,'附件能力','上传一份账单',44,220,298,25,'#FFFFFF','Bold'),txt(p,'真实格式限制','CSV / XLSX · 单文件 · 不超过 5 MiB\n发送后等待完整响应，不是实时上传进度。',44,280,298,13,'#E0EAF0'),txt(p,'原件说明','原文件用于后续确认，需校验长度和摘要。',24,409,342,13,MUT),txt(p,'草稿示例','草稿：请先预览，不直接写入。',24,492,342,15)]
    submit(o+composer(p,attachment=True)+nav(p),'upload')
    p=create('loading','AI06 等待完整回复 · 390×844',5)
    o=base(p,'AI 助理')+[rect(p,'已发送问题',82,139,284,72,'#E3EDF1'),txt(p,'发送问题','演示：帮我看看本月支出。',98,159,252,14),rect(p,'等待完整响应',24,244,342,144),icon(p,'等待图标',43,264,'M12 3a9 9 0 1 0 9 9 M12 6v6l4 2'),txt(p,'非流式等待标题','正在等待回复',80,264,260,17,INK,'Medium'),txt(p,'等待说明','收到完整响应后展示内容。\n离开页面不代表服务端请求已取消。',42,311,300,13,MUT),rect(p,'发送锁定容器',24,672,342,60,'#E8EBEC'),txt(p,'锁定输入说明','发送中 · 不重复发送',42,692,300,14,MUT)]
    submit(o+nav(p),'loading')
    p=create('empty-filter','AI07 预览筛选空态 · 390×844',6)
    o=importtop(p)+[rect(p,'空结果卡',24,330,342,228),icon(p,'空结果搜索',178,357,'M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M15 15l6 6'),txt(p,'空态标题','当前预览中没有匹配项',56,413,280,18,INK,'Medium'),txt(p,'空态说明','搜索只覆盖返回的预览行。\n清除搜索或切换筛选，不扩大文件范围。',42,454,310,13,MUT)]+button(p,'清除搜索','清除搜索',40,500,310,'#E7EFF3',ACC)+footer(p,'0')
    submit(o,'empty-filter')
    p=create('error','AI08 确认异常 · 核对终态 · 390×844',7)
    o=base(p,'导入状态',True)+[rect(p,'核对异常 Hero',24,127,342,226,HERO),icon(p,'核对提示',43,149,'M12 3L2 21h20z M12 9v5 M12 17v1','#FFFFFF'),txt(p,'确认异常标题','结果需要核对',44,198,298,25,'#FFFFFF','Bold'),txt(p,'异常解释','请求未得到明确结果。\n先刷新服务端状态，不自动重复提交。',44,260,298,14,'#E0EAF0'),rect(p,'过期补充说明',24,379,342,146),txt(p,'卡片过期说明','若卡片已过期',42,395,304,16,INK,'Medium'),txt(p,'过期建议','预览变化、原件不匹配或参数边界不一致\n都可能使卡片过期。重新生成预览后核对；\n未知状态不开放确认。',42,432,304,13,MUT)]+button(p,'刷新核对','刷新并核对状态',24,722)
    submit(o,'error')
    p=create('submitting','AI09 提交锁定 · 390×844',8)
    o=base(p,'导入确认',True)+[rect(p,'核对摘要',24,112,342,218),txt(p,'确认摘要标题','正在提交已选 2 条',42,139,304,23,INK,'Bold'),txt(p,'确认摘要字段','支出金额：¥ 30.00\n分类覆盖：餐饮、交通\n分类可能新建或恢复，需核对服务端结果。',42,189,304,14,MUT),rect(p,'异步操作说明',24,362,342,132,'#E7EFF3'),txt(p,'操作说明','不重复发送确认请求。\n本地动画不代表提交成功。\n离开页面也不意味着服务端撤销写入。',42,387,304,14,ACC)]+footer(p,'2',True)
    submit(o,'submitting')
    p=create('result','AI10 已确认结果 · 390×844',9)
    o=base(p,'导入结果',True)+[rect(p,'结果 Hero',24,127,342,233,HERO),icon(p,'确认完成',43,149,'M4 12l5 5L20 6','#FFFFFF'),txt(p,'终态标题','服务端已确认',44,202,298,26,'#FFFFFF','Bold'),txt(p,'合成结果','演示结果：已导入 2 条\n支出合计 ¥ 30.00',44,266,298,16,'#E0EAF0'),rect(p,'终态约束',24,391,342,128),txt(p,'结果边界','结果数据以服务端返回为准。\n已确认卡片不再提供执行或取消。\n清理本次附件、选择和分类覆盖。',42,414,304,14,MUT)]+button(p,'返回原会话','返回对话',24,722)
    submit(o,'result')
    p=create('keyboard','AI11 分类编辑 · 键盘态 · 390×844',10)
    o=base(p,'编辑分类',True)+[rect(p,'目标预览行',24,111,342,120),txt(p,'目标合成交易','云朵咖啡 · ¥ 28.00',42,131,304,19,INK,'Medium'),txt(p,'分类不是ID','2026-10-08 · 支出 · 分类文字覆盖',42,177,304,12,MUT),txt(p,'分类标签','分类名称',24,260,342,14,INK,'Medium'),rect(p,'分类输入框',24,294,342,52),txt(p,'输入草稿','餐饮',40,309,302,16),txt(p,'副作用与归一说明','可能新建 / 恢复同名分类。\n拟实施：去首尾空格、限制 80 字符后再核对。',24,366,342,13,MUT)]+button(p,'保存分类草稿','保存本地分类草稿',24,470)+[rect(p,'键盘区域示意',0,548,390,278,'#DDE2E5',0),txt(p,'键盘示意标题','系统输入法示意 · 非产品组件',24,561,342,12,MUT)]
    for j,line in enumerate(['Q   W   E   R   T   Y   U   I   O   P','A   S   D   F   G   H   J   K   L','Z   X   C   V   B   N   M','中文         空格          完成']):
        o += [rect(p,'键盘示意行 '+str(j),16,593+j*51,358,43,'#FFFFFF',8),txt(p,'示意键帽 '+str(j),line,30,603+j*51,340,16,INK,'Medium')]
    submit(o,'keyboard')
    p=create('truncated','AI12 超过200行 · 明确截断 · 390×844',11)
    o=importtop(p,True)+[rect(p,'截断提示',24,314,342,140,'#E7EFF3'),txt(p,'截断警示标题','文件更多内容未显示',42,331,304,18,INK,'Medium'),txt(p,'截断范围说明','仅展示文件前 200 行，搜索和筛选同样受限。\n不能选择未展示行，也不提供全文件全选。\n请拆分文件后重新上传，最多选择 100 条。',42,369,304,12,ACC)]+rows(p,472,1)+[txt(p,'选择上限说明','已达 100 条：可取消已选，不再新增选择。\n导入必须发送显式 ID 数组，不能省略/null。',24,608,342,13,MUT)]+footer(p,'100')
    submit(o,'truncated')
    p=create('confirm','AI13 导入二次核对 · 390×844',12)
    o=base(p,'确认导入',True)+[rect(p,'确认摘要 Hero',24,112,342,198,HERO),txt(p,'待提交标题','核对后再写入',42,137,306,26,'#FFFFFF','Bold'),txt(p,'明确选择摘要','已选 2 条 / 前 12 行预览\n支出 ¥ 30.00 · 收入 ¥ 0.00\n疑似重复：0 条已选',42,190,306,15,'#E0EAF0'),rect(p,'分类与文件核对',24,340,342,193),txt(p,'核对项标题','本次确认范围',42,360,306,17,INK,'Medium'),txt(p,'合同说明','仅提交显式选中的 ID；原件需匹配。\n分类覆盖：餐饮、交通（本地选择值）。\n分类可能新建或恢复；服务端预览不一定\n显示覆盖后的分类，最终结果需核对。',42,405,306,13,MUT),txt(p,'确认危险范围','取消卡片不是撤销已完成的账务。',24,567,342,13,MUT)]+button(p,'返回修改','返回修改',24,650,342,'#FFFFFF',ACC)+button(p,'明确确认写入','确认导入 2 条',24,718)
    submit(o,'confirm')
    (ROOT/'ai-ardot-evidence'/'screen-index.json').write_text(json.dumps(screens,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(screens,ensure_ascii=False,indent=2))
if __name__=='__main__':build()
