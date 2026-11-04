# AI 流式对话与交互式追问综合验收总结 (Task 10-15)

状态：**PARTIAL / NOT ACCEPTED（部分达标，整体未通过验收）**  
采集与评估时间（UTC）：2026-10-16T15:00:00Z  
核验依据：
- `prd.md`、`design.md`、`implement.md`、`research/protocol-v1.md`
- `research/chained-choice-fix.md`、`research/android-retest-handoff.md`、`research/release-postfix-acceptance.md`、`research/aba-provider-failure.md`
- 任务 artifacts：
  - `artifacts/phone-verifier-chained-choice/round2/REPORT.md` 及实际 JSON/TXT
  - `artifacts/phone-verifier-lifecycle/stop/REPORT.md` 及实际 JSON
  - `artifacts/phone-verifier-lifecycle/visible-stream/REPORT.md` 及实际 JSON/帧截图
  - `artifacts/phone-verifier-lifecycle/conversation-aba/REPORT.md` 及实际 JSON
  - `artifacts/phone-verifier-lifecycle/conversation-aba-retest/REPORT.md` 及实际 JSON

---

## 1. 总体结论与核心判定

综合服务端、客户端单元与静态检查、补丁部署物独立复核以及真机 4 组专项验收的实际结果，本任务在**流式基础链路、0-delta 占位与停止、连续追问单选与多帧正文增量渲染、会话生命周期隔离**等架构层面均已证实有效；但因**上游大模型 Provider 响应超时与 Envelope 解析失败导致 2 次真实回答生成失败**，且存在**流式滚动常驻药丸等交互瑕疵**，整体判定为 **PARTIAL / NOT ACCEPTED**，严禁宣称全量通过或归档任务。

| 模块 / 环节 | 判定 | 关键事实依据 |
|---|---|---|
| **服务端 (Server)** | **PASS（代码与部署已证实）** | 本地 24 个测试文件 / 582 项测试全绿；lint/typecheck 0 告警；生产编译 `BUILD_EXIT=0`；线上部署镜像 `jizhang:api-chained-choice-20261016T083118Z`（SHA-256 `31bb967e...`），new-answer 自身插入 `NULL` 修复已生效且 22/22 数据库表无结构变动，有效密钥哈希完全一致 |
| **客户端 (Android)** | **PASS（源码与构建已证实）** | 10 个测试套件 / 91 项 JVM 单元测试全绿（Gradle Test XML 严格核实实际测试数，基线 89→91 项）；`lintDebug` 0 errors / 9 warnings；`assembleDebug` 编译成功；本地 Debug APK SHA-256 `5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e` 与真机已安装 base.apk pull 回字节完全一致（`cmp` IDENTICAL）；前序 4 组专项基线 APK `d2a37b55...` 作为历史版本保留 |
| **连续追问真机实测 (Round 2)** | **PASS（限定于新会话链路）** | 新会话 Choice A -> Question B -> Choice B 推进成功（S1 到 answer，S2 到 pending-confirmation）；代次 `answered_option_id/answered_at` 插入 NULL 证实；49 份 UI 树扫描 0 处 `ASSISTANT_CHOICE_STALE`；旧 stuck 卡（`863a936c`/`ccf489cb`）保持已答不修不翻案；16 张账务/业务表 SHA-256 哈希完全一致 |
| **首字前占位与 Stop (Stop 专项)** | **PASS** | 发送后首字到达前（TTFT 阶段，+1.103s）明确渲染占位气泡并成功点击 Stop；服务端代次状态确认为 `cancelled`（3 条事件 accepted->running->cancelled，0 delta，0 消息）；UI 明确显示“已由用户手动停止生成（未执行记账）”；3.5s 静默期无迟到卡片；账本计数未变 |
| **流式正文增量呈现 (Visible Stream)** | **PASS（多帧增长与去重已证实）** | 发送只读预算请求，TTFT 阶段展示占位气泡；捕获 35 帧原生真机截图（~450ms 采样周期，与服务端 36 条 delta 时间区间吻合，非微秒对齐），正文在同 1 气泡内从 Tip 1 经 Tip 2 延伸至 Tip 3；终态由单个 final 气泡原子接管去重，全屏无双泡；3.5s 静默无迟到卡片；账本计数未变。注：占位文案“结构化草案”为 UI 既有沿用文案，信息类问答不代表已生成财务草稿 |
| **会话切换隔离 (ABA 专项)** | **有限 PASS / 核心生成 FAIL** | 优化时序补测中，发送后 +1.68s 切入会话 B（远早于服务端 terminal），服务端代次在离开后持续 `running`，在 B 停留 2.07s 后于 +4.91s 切回 A；会话 B 完全隔离（0 消息、0 代次）；切回 A 严格对齐同一代次（全局代次仅增 1，无重复创建，无双泡）。**但该代次在 +20.002s 触发上游 TTFT 超时导致 `failed`（未产出成功回答）；首轮 ABA 代次在 219 字符时因 `INVALID_ENVELOPE` 失败，两项失败记录保持 FAILED 不可改判 PASS**（Provider 审查已证实 20s 超时严格按照 saved 全 call 预算执行，未捕获原始 payload 不得称 parser 脆弱性，100% 外部成功率非既定契约） |
| **流式滚动药丸修复与实机复测** | **PASS（实机闭环已证实）** | 客户端经由 `snapshotFlow` 监听 `Triple(newMessagesAvailable, atBottom, isScrollInProgress)` 并通过独立 review；实机实测（`artifacts/phone-verifier-scroll-live-retest`）流式期间离底阅读触发“有新消息，跳到最新”药丸（Frame 14~21），`04-terminal.xml` 处药丸为 1（合法未触底），`06-scroll-bottom.xml` 自然触底滑动后药丸自动消失为 0（未点击药丸）；期间额外自然 swipe 发生在终态后数分钟，不宣称 terminal 瞬间自动清除或微秒时序；35 帧原生采样 ~400ms，总 event payload 字节非正文字符数；无双泡残留 |
| **财务账本安全** | **PASS（零隐式记账已证实）** | 全流程零 `/confirm` 调用，无自动记账。round2 中 16 张非 assistant 业务表 SHA-256 哈希逐一持平；Stop/Visible/ABA/Scroll 专项中核实了表记录行数保持（59/2/11），计数保持不能扩大等同于全量哈希不变，但足以证明无新增记录 |
| **可靠性与端到端交付** | **PARTIAL / NOT ACCEPTED** | 核心已列功能专项通过；外部 provider 可靠性有两失败记录 / 大字弱网长对话未全测，完整验收仍 PARTIAL。旧 spec 保留失败 partial provisional 机制与不自动 retry，不建议违约静默 fallback 或改 timeout/model |

---

## 2. 真实核验数据与证据路径映射

### 2.1 服务端构建与部署验证
- **本地自动化测试**:
  - 命令: `cd packages/server && npm test`
  - 结果: 24 test files / 582 tests passed (0 failures)
  - 验证日志: `artifacts/server-tokenizer-fix-test-20261016-131148.log`、`artifacts/release-postfix-review/backend-focused-tests.log`
- **代码质量与构建**:
  - `npm run lint`: clean (`--max-warnings 0`)
  - `npm run typecheck`: clean
  - `npm run build`: clean (`BUILD_EXIT=0`)
- **独立 Probe 检验（含负对照）**:
  - 脚本: `artifacts/release-postfix-review/independent-chained-choice-probe.mjs`
  - 正对照: I1~I8 全部通过，账本行数 0 变动
  - 负对照 (恢复 pre-fix 逻辑): 准确复现 I1/I2b `ASSISTANT_CHOICE_STALE` 失败，证明探针有效
- **线上容器镜像与补丁身份**:
  - 镜像名称: `jizhang:api-chained-choice-20261016T083118Z`
  - 镜像 SHA-256: `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`
  - 编译产物指纹: `assistant-generation-service.js` = `60fc43e0...476f6c`
  - 编译产物差异: 241/241 文件对比仅 2 个文件（`.js` 与 `.js.map`）改变，全量环境变量有效值 SHA-256 完全一致（`artifacts/chained-choice-deploy-20261016T083118Z-env-comparison.json`）
  - 数据库表结构: 部署前后均为 22 张表，added `[]`、removed `[]`、changed `[]`

### 2.2 Android 客户端构建与版本对齐
- **本地单元测试**:
  - 命令: `cd clients/android && ./gradlew testDebugUnitTest --no-parallel`
  - 结果: 10 test suites / 91 tests passed (0 failures, 0 errors, 0 skipped，100% 通过)
  - 测试报告 XML: `clients/android/app/build/test-results/testDebugUnitTest/*.xml`（10 个 XML 文件，testcase 节点数总和为 91；AssistantConversationHelperTest 25 项，含 2 项本轮新增 Triple vs Pair 回归测试）
- **代码静态检查与构建**:
  - `./gradlew lintDebug`: 0 errors / 9 warnings
  - `./gradlew assembleDebug`: BUILD SUCCESSFUL
- **已安装 APK 字节指纹**:
  - 最新本地产物: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
  - SHA-256: `5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`
  - 设备安装指纹: `adb shell pm path com.yansuu1.jizhang` 提取 base.apk，SHA-256 与本地包完全一致（`artifacts/phone-verifier-scroll-final/12-byte-equality.txt` 与 `phone-verifier-scroll-live-retest/00-current-base.apk`），执行覆盖安装（`install -r`，保留数据，未重装）；前序 4 组专项基线 APK `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8` 作为历史版本完整保留

### 2.3 真机功能验收 4 组专项证据映射

#### A. 连续追问 Round 2 (`artifacts/phone-verifier-chained-choice/round2/`)
- 设备: HUAWEI nova 7 Pro (JER-AN20 / Android 12)
- 链路验证:
  - S1 轮次: 会话 `45efb5e7`，发送 prompt -> AI 出第一问 `81750f01` (Choose category: Dining/Entertainment) -> 点 Dining -> 产生第二问 `66823722` (Which account: Alipay/WeChat)，代次自身 `answeredOpt=null, answeredAt=null` -> 点 支付宝 -> 成功推进至 `8cd41716` outcome=answer
  - S2 轮次: 会话 `17624436`，重复链路，点 Alipay 后成功推进至 `baee1991` outcome=pending-confirmation（生成待确认记账卡，停测未确认）
- 关键证据文件:
  - 代次状态: `23-gen-after-clickA.txt`、`26-gen-after-clickB.txt`、`38-s2-gen-after-A.txt`、`41-s2-gen-after-B.txt`
  - 409 扫描: `stale-scan.txt`（49 份 XML 零命中）、`49-s1s2-generation-status.txt`
  - 账本哈希: `50-manifest-after-round2.json`（16 张业务表哈希与部署前完全一致）
- 旧卡处理: 历史 stuck 卡 `863a936c`/`ccf489cb` 维持库中已答状态，按规范不修、不触碰，不宣称恢复

#### B. 首字前占位与 Stop 专项 (`artifacts/phone-verifier-lifecycle/stop/`)
- 会话: `c0d9126a-6dd4-41a3-9f0c-341b652503bd`
- 链路验证:
  - 发送 400 字建议 prompt，在 +0.5s~1.1s（首字到达前，TTFT 阶段）屏幕明确呈现占位气泡与“停止生成”按钮
  - 在 +1.103s 成功点击 Stop 按钮
  - UI 立即切换为停止终态（气泡提示“已由用户手动停止生成（未执行记账）”，底部输入框恢复）
  - 服务端代次 `dc9da3e7-1676-40aa-aed1-697eb04f849d` 状态确认为 `cancelled`，仅 3 条事件（seq 1: accepted, seq 2: running, seq 3: terminal cancelled），无任何 `text-delta`，无 message
  - 终态后 3.5s 静默期 UI 保持一致，无迟到卡片
- 关键证据文件:
  - 截图与 XML: `06a-connecting-placeholder.png`、`06b-stop-clicked.png`、`06-stop-clicked.xml`、`07-terminal-quiescent-3s.png`
  - 服务端证据: `08-server-generation-evidence.json`、`11-ledger-counts.json` (transactions=59, pending_actions=11)

#### C. 正文增量多帧呈现与去重 (`artifacts/phone-verifier-lifecycle/visible-stream/`)
- 会话: `f59a2d6e-7f10-48a1-ab2b-504995a2ed37`
- 链路验证:
  - 发送 150 词预算规划请求，TTFT 阶段（+0.563s）渲染 `StreamProvisionalBubble`（含占位进度条与免记账说明）
  - 启动真机原生短周期截屏（每 ~450ms 采样 1 帧，捕获 35 帧），真实捕捉到同一气泡内正文自适应递增：
    - `cap_10.png` (+3.295s): 占位符消失，Tip 1 早期文字出现
    - `cap_12.png` (+4.199s): Tip 1 渲染完成，Tip 2 延伸中
    - `cap_14.png` (+5.092s): Tip 2 渲染完成，Tip 3 延伸中
    - `cap_17.png` (+6.378s): Tip 3 接近结尾
  - 终态到达后（`cap_19.png` 与 `12-terminal.png`），Provisional 气泡被最终消息原子接管，全屏严格保持 1 个 Assistant 消息气泡，附带“✓ 回答已结束 · 本轮未执行记账”标签，无双泡
  - 3.5s 静默期无迟到卡片
- 关键证据文件:
  - 截帧流水: `stream_frames/cap_01.png` ~ `cap_35.png`、`stream_frames/timeline.txt`
  - 终态与静默: `12-terminal.png`、`12-terminal.xml`、`13-quiescent-3s.png`
  - 服务端证据: `14-server-generation-evidence.json`（36 条 delta 累计 808 字符）、`15-ledger-counts-final.json` (transactions=59, transfers=2, pending_actions=11)
- **语义澄清声明**: 气泡顶部徽章文案「● 流式生成中 · 结构化草案」为 Android 客户端既有 UI 视觉规范沿用，用于表示正在增量接收结构化响应；在纯信息建议类问答中，**该文案仅为 UI 视觉占位，绝不代表系统已生成或正在处理任何真实的财务记账草案**。

#### D. 真实跨会话切换 A->B->A 隔离 (`artifacts/phone-verifier-lifecycle/conversation-aba-retest/`)
- 会话: 会话 A (`3642b8f8...`) 与 会话 B (`06bd1235...`)，经会话管理独立创建并持久化
- 链路验证:
  - 移除旧脚本中高耗时的 uiautomator dump，实现原生轻量时序控制
  - 发送后 +1.14s 打开列表，+1.68s 切入会话 B（远早于服务端 terminal）
  - 会话 B 纯净零污染：服务端数据库确认 `generations=0, messages=0`，界面无会话 A 内容
  - 在 B 停留 2.07s，于 +4.91s 切回会话 A
  - 离开 A 期间服务端代次 `21dba779-3d9f-4b59-b631-d294b6c371ba` 持续处于 `running` 状态（直至 +14.16s 仍为 running），证实离开会话不中断服务端执行
  - 切回 A 原子对齐同一代次，全局代次计数仅增 1，无重复创建，历史提问无双泡
  - **失败事实**: 该代次在等待首字 20 秒后，于 +20.002s 触发上游 TTFT 超时中断（`status: failed`, `error_code: ASSISTANT_STREAM_BOUNDS`, `error_message: AI 响应超时，本次生成已中断。`），未能产出有效回答
  - 首轮 ABA 记录 (`artifacts/phone-verifier-lifecycle/conversation-aba/`): 代次 `3da7ef99` 产出 219 字符后因 `INVALID_ENVELOPE`（tokenizer 语法解析被拒，非 4000 字符上限，详见 `research/aba-provider-failure.md`）而失败，该失败项同样保持 FAILED，不可改判 PASS
- 关键证据文件:
  - 时序与代次: `device-timestamps.json`、`12-server-evidence.json`、`13-ledger-counts-final.json`
  - 界面截图: `06-A-generating.png`、`08-in-conv-B.png`、`10-back-to-conv-A.png`、`11-conv-A-terminal-quiescent-3s.png`

#### E. 滚动药丸实时路径实机复测 (`artifacts/phone-verifier-scroll-live-retest/`)
- 设备: HUAWEI nova 7 Pro (JER-AN20 / Android 12)
- 链路验证:
  - 发送 300 词只读预算规划建议，启动端上原生毫秒级短截图循环（35 帧，~400ms 采样周期，跨度 1792172458006~1792172471127）
  - 流式文本增量到达期间，手势上滑进入历史阅读视野；真机画面清晰呈现“有新消息，跳到最新”药丸按钮（Frame 14~21，1792172463235~1792172465841，与用户最新确认截图一致）
  - `04-terminal.xml` 处药丸保留 count=1（合法未触底，视口尚未处于真底部）
  - 随后在 `06-scroll-bottom.xml` 自然触底滑动后，真机 UI 树中药丸计数自动变为 0（药丸完全自动消失，未被点击）；期间额外自然 swipe 发生在终态后数分钟（01:43:00 vs 01:41:20），不宣称 terminal 瞬间自动清除或微秒时序
  - 服务端代次 `17a8ea28` 完成，96 条 text-delta（19294 bytes 为网络传输大小，非正文字符数；用户 210 + 助理 2152 字符）；无双泡残留，账本计数（59/2/11）保持未变
- 关键证据文件:
  - 帧截取与动作时间戳: `stream_frames/frame_01.png` ~ `frame_35.png`、`stream_frames/actions.txt`、`stream_frames/timeline.txt`
  - 终态与触底核对: `04-terminal.xml`、`04-terminal.png`、`06-scroll-bottom.xml`、`06-scroll-bottom.png`
  - 服务端证据: `02-presend-server.json`、`05-postsend-server.json`、`progress.log`

---

## 3. 保留的未解决可靠性问题与闭环说明

1. **外部大模型 Provider 响应超时与 Envelope 解析失败记录 (保持 FAILED)**：
   - 现象 1：在跨会话 ABA 补测中，模型代次在首字等待 20s 后触发 `AI 响应超时，本次生成已中断。` 导致生成失败；
   - 现象 2：在首轮 ABA 实测中，代次 `3da7ef99` 产出 219 字符后抛出 `ASSISTANT_STREAM_BOUNDS` / `INVALID_ENVELOPE` 终止；
   - 专项审查与合规结论（`research/provider-reliability-review.md`）：
     - 20s 超时严格按照 saved 全 call 预算执行（覆盖 headers + full body），`ai-provider-service.ts` 的单个 timer 与 remaining budget 传递完全符合 `protocol-v1.md` §Provider 契约，超时行为系正常有界超时保护；
     - 未捕获原始 payload（出于安全保护凭据不落盘），不能轻率断言为 parser 脆弱性；
     - 100% 外部大模型成功率并非既定契约要求；协议明确要求“Chat stream failure never auto-fallback/retry”、“fail explicitly at bound”与“do not mutate saved timeout/model/secret”；
     - 结论：两项失败记录如实保留为 FAILED，旧 spec 保留失败 partial provisional 机制与不自动 retry，坚决不建议违约静默 fallback 或改 timeout/model。

2. **已修复并闭环项：Compose 滚动药丸常驻交互瑕疵 (VERIFIED / CLOSED)**：
   - 经由 `Triple(newMessagesAvailable, atBottom, isScrollInProgress)` 最小架构修复，并在 `phone-verifier-scroll-live-retest` 实测中捕获离底显现与触底自动消退，该交互瑕疵已彻底解决并关闭。

---

## 4. 范围外与未充分验证项声明

1. **输入法 (IME) 与无障碍体验**：
   - 软键盘弹出时顶起输入框和基本可视区域已验证；
   - 但**大字体模式**、**系统显示缩放**以及**复杂 IME 状态下的长期多轮滚动锚定**未充分验证。
2. **弱网与异常网络中断**：
   - 验证了用户显式 Stop 和客户端离线取消订阅；
   - 但**传输层高延迟、TCP 丢包导致的半开连接 (half-open connection) 以及自动核对断流重连**未经过全量弱网模拟。
3. **账本全量哈希范围限定**：
   - 仅在连续追问 Round 2 阶段对 16 张非 assistant 业务表执行了全量 SHA-256 哈希比对证实绝对一致；
   - 在随后的 Stop、Visible Stream、ABA、Scroll 专项测试中，仅核对了表记录计数（59 笔 transactions、2 笔 transfers、11 笔 pending actions）保持未变，**严禁将计数不变夸大为全量数据哈希一致**。
4. **财务确认红线**：
   - 全程测试均未点击任何卡片的 `/confirm` 执行按钮，未产生任何新增账本记录。

---

## 5. 授权边界与最终结论

### 5.1 授权状态澄清
- **部署与实机验收授权**: 用户已明确授权并在前期会话中执行了后端补丁部署（Patch #2 `31bb967e`）、APK 覆盖安装（`5c004350...`）与真机 5 组专项验证。
- **Git 提交与归档授权**: 当前工作树包含大量未提交文件（201+ 混合改动），**用户未授权执行 git stage / commit，也未授权将本任务归档 (archive)**。必须保持所有任务文档和代码在工作树中真实存在，任务保持 `in_progress`。

### 5.2 最终结论
**核心已列功能专项通过；外部 provider 可靠性有两失败记录 / 大字弱网长对话未全测，完整验收仍 PARTIAL**，准确记录当前实施与未验项，等待 parent 验收。
