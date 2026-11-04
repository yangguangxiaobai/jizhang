# 手机功能验收结果（流式药丸实时路径 · scroll-live）

## 总体结论
**部分验证，暂不能判定达标** — 前置安装/后端身份与单次受控只读流式成功、账本零变动、终态单气泡无残留药丸均有实际证据；核心路径【流式中上滑→药丸出现→自然到底自动消失】因错过 pending 窗口、无药丸真机证据而未验证。
统计：达标 3 项；不达标 0 项；未验证 1 项。

## 验收明细
| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置安装与后端身份一致，不重装 | 已装 base.apk SHA256=5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e，versionCode=3/versionName=0.1.0，firstInstallTime 保持 2026-10-10；后端镜像 31bb967e 运行中；不重装/不清数据 | 实际 pull 当前包 `00-current-base.apk` SHA256=5c004350…968e，`cmp` 本地 `app-debug.apk` 结果 IDENTICAL；`dumpsys package` versionCode=3/versionName=0.1.0，firstInstallTime=2026-10-10 08:54:23 保留；SSH `docker images/ps` 确认 `jizhang:api-chained-choice-20261016T083118Z (31bb967e)` Up 8 hours (healthy)。证据：00-current-base.apk、progress.log（pm path/dumpsys/docker 段） | 达标 |
| 2 | 单次受控只读流式请求成功且零记账 | 新会话发送 1 条约 200 词只读预算建议（明确不记账）；仅允许 1 个新 model 请求；服务端代次 completed/stream、有 text-delta 增量；transactions/transfers/pending_actions 计数不变；不做 confirm/不清数据/不改配置 | 新建对话后输入 `UI TEST: Please provide 200 words … do not book any transaction.` 并在 2026-10-16T17:29:57Z 点击发送（EPOCH 1792171797366，全轮唯一 provider 请求）。只读 SSH 核代次 `770ea689` conversation `091eb632`：status=completed，outcome=answer，delivery=stream，last_seq=64；events 聚合 state=2/message=1/terminal=1/text-delta=60（bytes 12060，区间 1792171800487~1792171805117）；messages 仅 user(len175)+assistant(len1399)。账本前后一致：transactions 59、transfers 2、assistant_pending_actions 11（04-presend/06-postsend 一致）。证据：02-new-conv.*、03-typed-ready.*、04-presend-server.json、06-postsend-server.json、progress.log | 达标 |
| 3 | 流式中上滑→`有新消息，跳到最新`药丸出现→自然滑到底自动消失（实时 pending 真测） | 等待实际正文出现后主动上滑，药丸出现且视野保持（截图/UI 树）；后续有增量时自然滑到底（不点击药丸），停止拖拽后药丸自动消失；final 无双泡。用短截图循环避免大 dump 漏窗口；server delta 不得当作手机可见 | 未捕获 pending 窗口：发送后仅做单帧 `05-send-1s.png`（sleep 1.2s）+ 延迟 `uiautomator dump`，未执行短截图循环；05 与 07 的 UI 树均为终态 `● 回答已结束` + 完整正文、PILL_COUNT=0（`grep 跳到最新/有新消息` 均为 0），属终态历史界面，按禁令不得当作 pending 真测。服务端 60 条 text-delta 仅证明上游成功，不计为手机可见。主动上滑/自然到底/自动消失三步均无真机证据。本轮已耗尽唯一的 1 个 provider 请求额度，禁止第二次请求，故无法补测。 | 未验证 |
| 4 | 终态单气泡、无残留药丸（辅助观察，不代替 pending 真测） | completed 终态全屏仅 1 条 Assistant 消息气泡，无双泡；无 `有新消息，跳到最新` 残留 | `07-final-terminal.txt/xml/png`（2026-10-16T17:31:17Z，发送后约 80s，服务端已 terminal 1792171805488）：仅 1 个 Assistant 正文节点（[84,480][996,1905]）+ `● 回答已结束`，`grep 药丸=0`，无双泡。05-send-1s 同样终态单气泡。此为终态观察，不证明 pending 自动消失。证据：05-send-1s.*、07-final-terminal.* | 达标 |

## 不达标原因
无。

## 未验证与阻塞项
- 编号 3（流式 pending 药丸真测）：方法缺口——发送后首字区间约 +3.1s~+7.7s（delta 1792171800487~1792171805117），但本轮采用单帧 screencap + 延迟 dump，未按要求使用真机短截图循环（~450ms/帧 + timeline），dump 实际落到终态（completed）之后，未记录到 `newMessagesAvailable=true` 的实时 pending 条件；按“不要把没有 pill 的历史界面当 pending 真测”纪律，05/07 的 0-pill 终态不得改判通过。继续验证需另行明确授权的**下一次**单 provider 请求，并在发送瞬间启动设备端短循环 + 发送后 2~8s 内执行上滑/到底动作，同时保留药丸出现与消失的截图/UI 树。本轮额度已用尽，未发起第二次请求、未超时、未 INVALID_ENVELOPE，属测试覆盖不足，非产品 FAIL。
- 本轮 `stream_frames/` 为空（未启动循环），`01-launch/02/03` 仅为前置取证；`05-send-1s.png` 首屏因时序已为终态，不单独作为流式可见证据。

## 执行环境与验证记录
- 设备/系统/应用版本：HUAWEI JER-AN20（TNL0220A15028072），Android 12，1080x2340@480dpi；应用 com.yansuu1.jizhang v0.1.0(3)；本地 APK SHA256=5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e；adb online（device）。服务端容器 `jizhang:api-chained-choice-20261016T083118Z (31bb967e)` healthy；主机/服务端时钟差约 +1.7s（HOST 1792171854605 vs SRV 1792171856337，仅作区间参考）。
- 实际执行步骤或命令（结果）：
  - `adb devices -l` → TNL0220A15028072 device；`getprop model/release` → JER-AN20/12；`pm path` → 与历史一致路径；`pull base.apk → 00-current-base.apk` → 1 file pulled；`sha256sum/cmp` → 双端 5c004350…968e IDENTICAL；`run-as ls shared_prefs` → 仅列文件名+大小（283 bytes），未输出凭据值。
  - SSH 只读（`~/.ssh/jizhang_deploy → ubuntu@jz.yansuu1.xyz`，BatchMode）：`docker images/ps` → 31bb967e 运行中；`SELECT COUNT(*)` 基线 assistant_messages 134/events 846/conversations 20，账本 59/2/11；发送前后 `04-presend-server.json`（MSGCOUNT 134）与 `06-postsend-server.json`（代次 770ea689 completed/stream/last_seq 64，60 deltas，LEDGER 59/2/11）均为只读 `better-sqlite3 readonly`，无 rows 内容输出、无 cookie/session/key、无私密账务。
  - 手机 UI（实际工具）：`am start MainActivity` → delivered to running instance；`screencap+uiautomator dump+parse_ui.py` 生成 01-launch/02-new-conv/03-typed-ready/05-send-1s/07-final-terminal 系列 .png/.xml/.txt；`tap (540,402)` 新建对话 → 02 显示空会话；`tap (525,2043)+input text 200w只读+keyevent 111` → 03 EditText 含完整 prompt；`tap (915,2055)` 发送 1 次（RC=0，EPOCH 1792171797366）→ sleep 1.2s 单帧 05；32s 后只读查库；80s 后 07 终态。`grep 跳到最新/有新消息` 05/07 均为 0；`grep 回答已结束` 终态=1。
  - 未执行项（按禁令）：未重装/卸载/清数据；仅 1 个新 model 请求，未发起第二个；未 confirm 真实记账；未改网络/字体/模型 timeout/重启部署/stage/commit；未改产品源码/标准/配置/已有截图（仅新增 phone-verifier-scroll-live/ 下 00/01/02/03/04/05/06/07 与 progress.log、本 REPORT）；未嵌套任务；server delta 未当作手机可见。
- 证据位置（均在 `artifacts/phone-verifier-scroll-live/`，相对仓库根 `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/`）：00-current-base.apk、01-launch.png/xml/txt、02-new-conv.png/xml/txt、03-typed-ready.png/xml/txt、04-presend-server.json、05-send-1s.png/xml/txt、06-postsend-server.json、07-final-terminal.png/xml/txt、stream_frames/（空，方法缺口如实记录）、progress.log、本 REPORT.md。历史依据：artifacts/phone-verifier-scroll-final/REPORT.md（未验证项来源）、research/scroll-indicator-review.md（JVM 91 passed 仅背景，不计真机）。
