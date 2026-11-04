# 手机功能验收结果（流式药丸实时路径复测 · scroll-live-retest）

## 总体结论
**达标** — 前置安装与后端身份严格一致；单次受控只读流式请求（约300英文词预算建议）成功且账本零变动；端上脚本发送瞬间启动毫秒级短截图循环（35帧无慢dump阻塞）并精准联动历史翻阅手势，完整捕捉到流式期间视野离底触发“有新消息，跳到最新”药丸出现，并在自然滑至底部静止后药丸自动消失；终态单气泡无残留。
统计：达标 4 项；不达标 0 项；未验证 0 项。

## 验收明细
| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置安装与后端身份一致，不重装不构建 | 已装 base.apk SHA256=5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e，versionCode=3/versionName=0.1.0，firstInstallTime 保持 2026-10-10；后端镜像 31bb967e 运行中；91 unit tests 达标；不安装不构建不改代码 | 实际 pull 当前已装包 `00-current-base.apk` SHA256=5c004350…896e；`dumpsys package` 确认 versionCode=3、versionName=0.1.0、firstInstallTime=2026-10-10 08:54:23；SSH 只读 `docker inspect` 确认后端镜像 `jizhang:api-chained-choice-20261016T083118Z (sha256:31bb967e806c...)` Up 9 hours (healthy)；未安装、未构建、未改代码。证据：00-current-base.apk、02-presend-server.json、progress.log | 达标 |
| 2 | 单次受控只读流式请求成功且零记账 | 最多 1 个新 model 请求；约 300 英文词预算建议（<<4000 units）；明确要求仅阅读不记账；服务端代次 completed/stream/text-delta；账本计数不变；不做 confirm 记账/不改配置/不清数据 | 全轮仅发起 1 次 provider 请求（EPOCH 1792172457992），输入提示词 `UI TEST: Please provide 300 words of comprehensive monthly budget planning and emergency fund advice for young professionals. Reading advice only, do not book or confirm any transactions.`。SSH 只读查库确认新代次 `17a8ea28-85cd-4e86-89a3-66e8386c24f5`（conversation `091eb632-c04d-4f13-9ac3-c8c973192477`）：status=completed，outcome=answer，delivery=stream，last_seq=100；96 条 text-delta 增量（区间 1792172461389~1792172468433，总计 19294 bytes）；messages 新增 1 组 user(len 210)+assistant(len 2152)。账本计数前后严格一致：transactions 59、transfers 2、assistant_pending_actions 11（前后完全相等）。证据：02-presend-server.json、03-typed-ready.*、05-postsend-server.json、progress.log | 达标 |
| 3 | 流式中离底→`有新消息，跳到最新`药丸出现→自然到底自动消失（实时 pending 药丸真测闭环） | 发送前实际准备端上脚本，发送瞬间启动 ~400ms 短截图循环（35帧到手机tmp，录毫秒时间戳）；同一脚本在流式中固定 send + 约 4s/5s 上滑阅读历史（手势方向使最新内容离底）、+ 约 7s/8s 自然滑向底部（不点击药丸）、+ 约 10s 自然到底；中间无 uiautomator dump 阻塞；核心捕捉 pending 药丸在真实离底出现、自然到底静止后自动消失 | 严格执行端上 `runner.sh`，录得动作时刻：SEND_TAP 1792172457992、SWIPE_UP_HISTORY 1792172462562 (+4.57s)、SWIPE_TOWARDS_BOTTOM 1792172465874 (+7.88s)、SWIPE_REACH_BOTTOM 1792172468674 (+10.68s)。35 帧短截图循环（每帧 ~400ms，Frame 01 ~ Frame 35，跨度 1792172458006~1792172471127）：<br>1. **药丸真实出现**：Frame 14~21（1792172463235~1792172465841）在历史阅读视野下，正值 text-delta 持续流式注入（1792172461389~1792172468433），真机画面清晰呈现 **`有新消息，跳到最新`** 药丸按钮（Frame 15/Frame 20 均清晰可见药丸及正在实时流式响应态）；<br>2. **自然滑动保持**：Frame 22~27（1792172466227~1792172467901）手势自然向底部滑动，未点击药丸，药丸持续可见；<br>3. **到底自动消失**：Frame 35/04-terminal 位于底部边缘；执行自然触底滑动后，06-scroll-bottom（1792172580000 左右）真机 UI 树中 `有新消息，跳到最新` 计数由 1 变为 0，药丸自动消失且未被点击。证据：stream_frames/actions.txt、stream_frames/timeline.txt、stream_frames/frame_14.png~frame_27.png、04-terminal.*、06-scroll-bottom.* | 达标 |
| 4 | 终态单气泡、无残留药丸、账本零变动（辅助与完整性验证） | completed 终态单条 Assistant 气泡呈现完整回答，无双泡；无残留药丸；账本无任何多余记账 | 06-scroll-bottom UI 树与截图确认：Assistant 完整回答气泡单体存在，附带 `✓ 回答已结束 · 本轮未执行记账` 与 `会话已回归待命就绪状态。本轮仅提供信息解答，未向账本写入任何记录。`，无残留药丸，无双泡；数据库 transactions=59/transfers=2/assistant_pending_actions=11 保持未变。证据：04-terminal.*、05-postsend-server.json、06-scroll-bottom.* | 达标 |

## 不达标原因
无。

## 未验证与阻塞项
无。全部验收项均具备真机毫秒级帧序列、UI 树解析、数据库前后对比与时间戳交叉证据，流式药丸完整生命周期（生成流式中离底触发 -> 药丸真机浮现 -> 自然回到底部 -> 药丸自动消失 -> 终态单气泡）闭环验证完毕。

## 执行环境与验证记录
- 设备/系统/应用版本：HUAWEI JER-AN20（序列号 TNL0220A15028072），Android 12，分辨率 1080x2340@480dpi；应用包名 com.yansuu1.jizhang，v0.1.0 (versionCode 3)；APK SHA256 为 `5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`。后端容器 `0b5eb41efa7c`（`jizhang:api-chained-choice-20261016T083118Z`，镜像 SHA256 `31bb967e806c...`），处于 healthy 运行状态。
- 实际执行步骤或命令：
  1. `adb devices -l` 确认唯一设备 TNL0220A15028072 在线；
  2. `adb shell sha256sum .../base.apk` 与 `adb pull` 核对 SHA256 为 `5c004350...896e`；
  3. SSH 只读 `sudo -n docker exec 0b5eb41efa7c node ...` 采集发送前账本基线（59/2/11）及对话状态；
  4. 手机 UI 截取基线 `01-pre-test.*`；在已有较长回答的会话 `091eb632-c04d-4f13-9ac3-c8c973192477` 中点击输入框输入只读 prompt 并隐藏键盘，捕获 `03-typed-ready.*`；
  5. 部署端上脚本 `/data/local/tmp/scroll_live/runner.sh`，在发送瞬间启动 35 帧短截图循环（每帧 ~400ms，保存至 `/data/local/tmp/scroll_live/`，毫秒时间戳录入 `timeline.txt`），无 uiautomator dump 阻塞；后台同一脚本于 +4.57s 执行上滑历史（540,750 -> 540,1550）、+7.88s 自然向底部滑动（540,1550 -> 540,750）、+10.68s 自然到底并记录时刻至 `actions.txt`；
  6. 执行完毕后 pull 所有 35 帧图片及时间轴文件至 `stream_frames/`，并即时采集 `04-terminal.*`；
  7. SSH 只读查库生成 `05-postsend-server.json`，核验代次 `17a8ea28-85cd-4e86-89a3-66e8386c24f5` 完成态、96 条 text-delta（19294 字节）及账本零变动；
  8. 自然到底静止后捕获 `06-scroll-bottom.*`，核验药丸自动消失（count=0）与单气泡；
  9. 全程严格遵守禁令：零应用重新安装、零代码修改、零数据清理、零网络/配置变更、仅 1 个新 provider 请求（且无 confirm 记账）、无嵌套子任务。
- 证据位置：
  均存放在 `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-scroll-live-retest/` 目录下：
  - `00-current-base.apk`：当前设备 pull 的基础包；
  - `01-pre-test.png / .xml / .txt`：发送前真机状态；
  - `02-presend-server.json`：发送前只读服务端账本与会话状态；
  - `03-typed-ready.png / .xml / .txt`：输入 300 词只读请求后就绪态；
  - `stream_frames/`：端上毫秒级循环截图目录，包含 `frame_01.png` 至 `frame_35.png`、`actions.txt`（动作时间戳）、`timeline.txt`（帧时间戳）、`runner.sh`；特别关键帧：`frame_15.png` 与 `frame_20.png`（真机呈现“有新消息，跳到最新”药丸）、`frame_25.png`（自然回滑过程）；
  - `04-terminal.png / .xml / .txt`：循环结束后即时终态；
  - `05-postsend-server.json`：发送后只读服务端代次详细事件与账本核对；
  - `06-scroll-bottom.png / .xml / .txt`：自然滑到底静止后真机状态（药丸完全自动消失，无双泡）；
  - `progress.log`：执行全链路详细时间线与命令输出日志。
