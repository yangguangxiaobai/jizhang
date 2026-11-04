# Device Status & Physical Verification: AI Streaming & Interactive Dialogue (Task 10-15)

Status: **PARTIAL / NOT ACCEPTED（部分特性实测达标，整体未通过验收）**  
Device State: **ONLINE**  
Device ID: `TNL0220A15028072` (HUAWEI nova 7 Pro / JER-AN20 / Android 12 / SDK 31 / 1080x2340@480dpi)  
Installed APK SHA-256: `5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e` (v0.1.0(3)，通过 `adb install -r` 覆盖安装并 pull 回核对字节完全一致；前序基线 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8` 作为 4 组专项历史版本保留)  
Server Container: `jizhang:api-chained-choice-20261016T083118Z` (`sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`)  
Updated Timestamp (UTC): 2026-10-17T02:00:00Z  

---

## 1. Executive Summary & Verification State (真机复验结论)

针对首轮真机验收中发现的缺陷，服务端部署了 NULL-own-answer 核心修复补丁（Patch #2 `31bb967e`），客户端保持已通过 88 项单元测试与 Lint 的 APK `d2a37b55`。在真机上分 4 组专项开展了系统性实测核验：

1. **连续追问 Round 2 实测通过（限定于新会话链路）**：
   - 在新会话中成功验证 `Choice A -> Question B -> Choice B` 连续两跳推进（S1 推进至 answer，S2 推进至 pending-confirmation）；
   - 代次自身 `answered_option_id/answered_at` 正式插入 `NULL`，彻底根除“出生即已答”缺陷；
   - 49 份 UI 树全量扫描无任何 `ASSISTANT_CHOICE_STALE` 错误；
   - **历史 stuck 卡声明**：历史代次 `863a936c`/`ccf489cb` 因数据已持久化保持为已答状态，按规范坚决不修、不触碰，绝不虚假宣称恢复；
   - **账本哈希验证**：16 张账务及业务表 SHA-256 数据哈希在 Round 2 前后逐一完全相同，仅 assistant 表变更，无任何未授权记账。

2. **首字前占位与 Stop 专项实测通过**：
   - 彻底解决了首字到达前（TTFT 阶段）界面空白与 Stop 按钮缺失问题；
   - 发送后在首字到达前（约 +1.103s），UI 明确显示占位气泡及可点击的“停止生成”按钮，成功点击触发取消；
   - 服务端代次即时置为 `status: cancelled`（流水仅 accepted->running->cancelled 3 条事件，0 delta，0 消息）；
   - 终态后 3.5s 静默期内核对 UI，无任何迟到卡片或待确认事项，账本行数完全未变。

3. **流式正文增量多帧呈现与去重实测通过**：
   - 成功捕获 35 帧原生短周期真机截图（~450ms 采样周期，与服务端 36 条 delta 时间区间吻合，非微秒级对齐）；
   - 在同 1 个 Provisional 气泡中真实呈现正文字数随时间连续递增（Tip 1 -> Tip 2 -> Tip 3），与用户提供的实机录屏截帧完全吻合；
   - 达到 `completed` 终态后，Provisional 气泡由最终消息 `MessageItem` 原子接管，全屏严格保持 1 个 Assistant 气泡，无双泡；
   - **占位文案澄清**：顶部徽章文案「● 流式生成中 · 结构化草案」为 UI 既有视觉模板沿用；在纯信息建议类问答中，该文案仅为 UI 视觉占位，绝不代表后端已生成财务草案。

4. **真实跨会话 A->B->A 切换隔离（生命周期有限通过，模型生成超时失败）**：
   - 经由“会话管理”新建独立会话 A 与 B，采用微秒级轻量时序控制；
   - 发送后 +1.68s 切入会话 B（远早于服务端 terminal 发生时机），切入 B 后服务端代次持续保持 `running` 状态（直至 +14.16s 仍为 running），证实**离开会话仅关闭订阅，服务端生成不中断**；
   - 会话 B 数据库确认 `generations=0, messages=0`，界面完全隔离零污染；
   - 在 B 停留 2.07s 后于 +4.91s 切回会话 A，客户端调用 snapshot 对齐同一代次，全局总代次数严格仅增 1，无第二代次创建，历史无双泡；
   - **模型失败事实**：该代次在等待首字 20 秒后，于 +20.002s 触发上游 Provider 超时中断（`status: failed`, `error_code: ASSISTANT_STREAM_BOUNDS`, `AI 响应超时，本次生成已中断。`），未能产出成功答复；首轮 ABA 代次在 219 字符时因 `INVALID_ENVELOPE`（tokenizer 语法解析被拒，详见 `research/aba-provider-failure.md`）失败。**两项失败事实均如实记录为 FAILED，绝不篡改通过**。

5. **滚动药丸 Triple 修复与实机复测实测通过 (phone-verifier-scroll-live-retest)**：
   - 客户端经由 `snapshotFlow` 监听 `Triple(newMessagesAvailable, atBottom, isScrollInProgress)` 并在自然触底时自动清除药丸；经 10 套件 / 91 项 JVM 单元测试、Lint 与编译验证，独立 review PASS；
   - 用户两张最新截图证实离底显示/自然触底消失，与 `artifacts/phone-verifier-scroll-live-retest` 实测记录完全吻合；
   - 发送 300 词只读建议请求，端上毫秒级短截图循环（35 帧原生采样 ~400ms，跨度 1792172458006~1792172471127）；
   - 在流式接收期间上滑阅读历史，真机清晰呈现“有新消息，跳到最新”药丸（Frame 14~21）；
   - `04-terminal.xml` 处药丸保留 count=1（合法未触底）；
   - 随后在 `06-scroll-bottom.xml` 自然触底滑动后药丸自动消失（count=0，未点击药丸）；期间额外自然 swipe 发生在终态后数分钟（01:43:00 vs 01:41:20），不宣称 terminal 瞬间自动清除或微秒时序；
   - 总 event payload 字节（19294 bytes across 96 deltas）为网络传输包大小，非正文字符数（用户 210 + 助理 2152 字符）；无双泡残留。

6. **整体结论**：
   核心已列功能专项通过；外部 provider 可靠性有两失败记录 / 大字弱网长对话未全测，完整验收仍 **PARTIAL / NOT ACCEPTED**，待 parent 验收。旧 spec 保留失败 partial provisional 机制与不自动 retry，不建议违约静默 fallback 或改 timeout/model。财务数据全程零变更，零未授权记账。

---

## 2. Interactive Feature Verification Status Checklist

| # | 测试项 | 规约要求 | 实际核查状态 | 事实与缺陷说明 | 证据路径 |
|---|---|---|---|---|---|
| **1** | **保留数据安装与哈希比对** | APK SHA-256 与真机 base.apk 一致 | **VERIFIED** | 本地新 APK SHA-256 与真机已安装 base.apk 均为 `5c004350...896e`（字节一致，未重装）；前序基线 `d2a37b55...` 历史保留 | `00-current-base.apk`、`round2/01-installed-apk-sha256.txt` |
| **2** | **连续追问单选 (A->B->继续)** | Choice A -> Question B -> Choice B 顺畅推进，代次自身 `answered_at=null` | **VERIFIED** | 新会话 S1/S2 两轮测试全绿，代次自身插入 NULL，无 409 STALE，旧卡不修不翻案 | `round2/26-gen-after-clickB.txt`、`round2/stale-scan.txt` |
| **3** | **首字等待占位 (TTFT)** | 发送后首字到达前渲染占位气泡与进度条，无大面积空白 | **VERIFIED** | 发送后约 0.5s 立即呈现 `StreamProvisionalBubble`，含占位文字与进度条 | `stop/06a-connecting-placeholder.png`、`visible-stream/stream_frames/cap_04.png` |
| **4** | **首字前显式 Stop 与取消** | 首字到达前 Stop 按钮可用并可点击，服务端代次正确取消 | **VERIFIED** | 于 +1.103s 点击 Stop，服务端代次变为 `cancelled`（0 delta，0 消息），3.5s 静默无迟到卡片 | `stop/06b-stop-clicked.png`、`stop/08-server-generation-evidence.json` |
| **5** | **流式正文增量可见与多帧递增** | 同一气泡内正文随时间多帧连续增长，非 placeholder->final 跳变 | **VERIFIED** | 捕获 35 帧真机截帧（~450ms 采样），气泡自适应拉伸，文字连续从 Tip 1 延伸至 Tip 3 | `visible-stream/stream_frames/cap_10~17.png`、`timeline.txt` |
| **6** | **终态替换与消息去重** | completed 终态到达后，Provisional 气泡被最终消息原子接管，无双泡 | **VERIFIED** | 全屏确认仅 1 条 Assistant 消息，附带免记账说明，输入框恢复可用，零重复无双泡 | `visible-stream/stream_frames/cap_19.png`、`visible-stream/12-terminal.png` |
| **7** | **会话切换生命周期隔离 (ABA)** | 切入 B 期间服务端生成不中断；B 零污染；切回 A 对齐同代次无第二代次 | **VERIFIED** | +1.68s 切 B 早于 terminal，服务端代次持续 running；B 数据库代次/消息均为 0；切回 A 对齐同代次 | `conversation-aba-retest/device-timestamps.json`、`12-server-evidence.json` |
| **8** | **模型端到端生成可靠性** | 真实 LLM 在各测试场景下稳定产出有效答复 | **FAILED** | ABA 补测等待 20s 触发上游 TTFT 超时中断；ABA 首测 219 字符抛出 `INVALID_ENVELOPE` 失败。两失败记录保持 FAILED；Provider 审查证实 20s 覆盖全 call 预算且未获原始 payload 不得称 parser 脆弱性，100% 外部成功率非既定契约 | `conversation-aba-retest/12-server-evidence.json`、`research/provider-reliability-review.md` |
| **9** | **输入法 (IME) 界面适配** | 软键盘弹出顶起输入框与气泡，输入区不被遮挡 | **PARTIAL** | 基本软键盘弹出收起适配已实测正常；但大字体排版与缩放模式未验证 | `stop/03-typed.png`、`stop/04-keyboard-hidden.png` |
| **10** | **滚动跟随与常驻药丸交互** | 发送与流式期间视口平滑跟随，阅读历史离底显药丸，自然触底自动消退 | **VERIFIED** | snapshotFlow Triple 修复并通过独立 review；实机实测离底药丸出现，04-terminal 留存 1（合法未到底），06-scroll-bottom 自然触底自动消失（count=0），无残留 | `stream_frames/frame_15.png`、`04-terminal.xml`、`06-scroll-bottom.xml` |
| **11** | **财务账本零隐式记账红线** | 无论流式、选项点击或中止，绝不擅自记账 | **VERIFIED** | 全程未调用 `/confirm`；Round 2 证实 16 张业务表哈希一致；Stop/Visible/ABA/Scroll 证实行数保持不变 | `round2/50-manifest-after-round2.json`、`visible-stream/15-ledger-counts-final.json` |

---

## 3. 保留缺陷与未全量验证项

1. **外部大模型 Provider 响应超时与 Envelope 解析失败记录 (FAILED)**:
   - 在真实跨会话 ABA 专项中，代次因上游首字超过 20s 触发超时中止；首轮代次因 219 字符处 envelope 格式被 tokenizer 拒收中止；
   - 经 `research/provider-reliability-review.md` 审查：20s 超时严格按照 saved 全 call 预算执行（包含 headers + full body）；在未捕获原始 payload 情况下不得断言为 parser 脆弱性；100% 外部成功率非既定契约。两项失败记录如实保留为 FAILED，旧 spec 保留失败 partial provisional 机制与不自动 retry，不建议违约静默 fallback 或改 timeout/model。
2. **已修复项：滚动药丸常驻交互瑕疵 (VERIFIED / CLOSED)**:
   - 经 `Triple(newMessagesAvailable, atBottom, isScrollInProgress)` 修复并在 `phone-verifier-scroll-live-retest` 实测闭环，离底药丸显现，自然触底自动消失（count=0），该缺陷已关闭。
3. **未全量验证项 (INCONCLUSIVE)**:
   - **大字排版与系统无障碍缩放**：未在不同 Display/Font Scale 下验证气泡和选项卡布局；
   - **弱网断流与半开连接**：仅验证了显式 Stop 与退出页面，未验证恶劣弱网环境下的流式重试与数据完整性对齐；
   - **长会话多轮滚动性能**：未在 20+ 轮长对话中实测 Compose LazyColumn 的滑动帧率与内存稳定性。
   - **账本哈希验证范围**：除 Round 2 验证了 16 表 SHA-256 哈希一致外，Stop、Visible-Stream、ABA、Scroll 专项仅验证了表记录计数（59/2/11）不变，未计算全量数据哈希，严禁过度宣称哈希一致。
4. **授权状态说明**:
   - APK 覆盖安装（`5c004350...`）已获授权并执行；git stage/commit 与任务归档未获授权；任务保持 `in_progress`，待 parent 验收。
