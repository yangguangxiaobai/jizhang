# 手机功能验收结果（正文增量可见与 Final 去重专项）

## 总体结论
**达标** — 在真机（HUAWEI JER-AN20 / Android 12）与在线生产环境上，成功发送 1 条只读预算建议测试请求；在 LLM 首字到达前（TTFT 阶段）真机成功呈现占位气泡；首字到达后，在同 1 个 Provisional 气泡中真实捕捉到可读正文的出现与长度连续递增（捕获 35 帧短周期真机截图，正文从 Tip 1 经 Tip 2 持续延伸至 Tip 3，与服务端 36 条 text-delta 时间戳严格对齐）；生成结束达到 completed 终态后，Provisional 气泡被最终消息原子接管，确认全屏仅存在 1 条 Assistant 消息气泡（无双泡），终态后 3.5 秒静默期内无任何迟到卡片注入，账本表与待确认动作表零变动。  
统计：达标 7 项；不达标 0 项；未验证 0 项。

## 验收明细

| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置环境与已安装版本校验 | 设备在线且前台可操作；已安装 APK 保持为 `d2a37b55`；后端运行含 `31bb967e` 镜像 | 设备 `TNL0220A15028072` (JER-AN20 / Android 12) 在线并处于前台；已装 APK SHA-256 确认为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`；后端镜像为 `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` — 证据：`01-device-identity.txt`、`02-installed-apk-sha256.txt`、`03-server-identity.txt`、`04-ledger-baseline.json` | 达标 |
| 2 | 独立测试会话创建与只读请求输入 | 新建独立测试会话，输入 1 条只读约 150~200 词实用预算规划建议请求，明确仅供阅读不记账 | 创建独立会话 `f59a2d6e-7f10-48a1-ab2b-504995a2ed37`；输入内容：`UI TEST: Please provide 3 practical budgeting tips for young professionals in 150 words. Reading advice only, do not book transactions.` — 证据：`10-new-conv.png`、`10-new-conv.xml`、`11-ready-state.png`、`11-ready-state.xml` | 达标 |
| 3 | 首字等待阶段（TTFT）Provisional 占位气泡可见 | 发送后在首字到达前（约 3.3s），手机端正文区域真实呈现 `StreamProvisionalBubble`，不仅有顶部实时徽章，更有页面占位气泡 | 发送后 1792161524136 至 1792161527441 期间，真机画面渲染 `StreamProvisionalBubble`，包含徽章 `● 流式生成中 · 结构化草案`、动态 Progress Bar、`正在生成回答...` 占位文字、免记账说明及 `停止生成 (保留已输出片段)` 按钮 — 证据：`stream_frames/cap_04.png` (时间戳 1792161524699，发送后 +0.563s) | 达标 |
| 4 | 手机端正文增量可见与长度递增捕获 | 采用真机原生 screencap 短周期循环，在同一 Provisional 气泡中捕获正文从出现到长度递增的真实画面，非 placeholder->final 跳变 | 在同 1 个气泡内捕获正文逐步增长并经视觉确认：<br>1) `cap_10.png` (1792161527431)：占位符消失，Tip 1 早期文字出现（至 `emergency`）；<br>2) `cap_12.png` (1792161528335)：Tip 1 完整渲染，Tip 2 正在延伸（至 `starting split—50`）；<br>3) `cap_14.png` (1792161529228)：Tip 2 完整呈现，Tip 3 正在延伸（至 `such as dining`）；<br>4) `cap_17.png` (1792161530514)：Tip 3 接近结尾（至 `cancel services you no`）；<br>气泡随内容自适应拉伸，文字清晰可读 — 证据：`stream_frames/cap_10.png`、`cap_12.png`、`cap_14.png`、`cap_17.png`、`timeline.txt` | 达标 |
| 5 | 服务端代次事件流序列与真机截帧时间区间吻合 | 查询服务端数据库，代次状态及 events 流水与真机截帧时间区间吻合（~450ms 采样周期跨时钟仅作时间区间对齐，非微秒级对齐） | 服务端代次 `4abe2b48-93bb-457b-b5d6-21288487cd02`：<br>• seq 1-2 (1792161524136): accepted/running<br>• seq 3-38 (1792161527441 ~ 1792161530912): 连续 36 条 `text-delta` 事件，累计 808 字符<br>• seq 39 (1792161531226): message<br>• seq 40 (1792161531226): terminal completed<br>服务端 delta 流水区间（1792161527441~1792161530912）与真机截帧增长区间（cap_10 1792161527431 至 cap_18 1792161530982）在区间范围内吻合 — 证据：`14-server-generation-evidence.json` | 达标 |
| 6 | 终态替换与 Final 消息去重确认（无双泡） | completed 终态到达后，Provisional 气泡被最终消息替换，全屏确认仅有 1 条 Assistant 消息，无双泡 | `cap_19.png` (1792161531376) 与 `12-terminal.png`/`12-terminal.xml` 显示：`ProvisionalBubble` 已自动卸载，由最终消息 `MessageItem` 接管；全屏仅且仅有 1 条 Assistant 消息气泡，其下附带 `✓ 回答已结束 · 本轮未执行记账` 状态卡；输入框恢复可用，确认零重复、无双泡 — 证据：`stream_frames/cap_19.png`、`12-terminal.png`、`12-terminal.xml` | 达标 |
| 7 | 终态后 3.5s 静默验证与账本记录数未变 | 终态后静默 3.5 秒无迟到卡片注入；财务账本表记录数未变 | 终态后等待 3.5s 抓取 `13-quiescent-3s.png` 与 `13-quiescent-3s.xml`，UI 树节点与文本完全一致，未注入任何新卡片；只读查询服务端账本：`transactions` 保持 59，`transfers` 保持 2，`assistant_pending_actions` 保持 11。注意：仅验证表记录行数未变，行数不变不代表全量记录 hash 不变 — 证据：`13-quiescent-3s.png`、`13-quiescent-3s.xml`、`15-ledger-counts-final.json` | 达标（计数未变，hash 未核） |

## 不达标原因
无。

## 未验证与阻塞项
1. **跨设备时钟与采样周期限制**：真机截图采样周期约为 450ms，设备与服务端存在时钟偏差，因此仅作时间区间对齐，无法断言微秒级对齐；
2. **账本记录哈希未核验**：账本仅核验表记录计数（59/2/11）不变，计数不变不能严格证明数据行 hash 不变。

## 执行环境与验证记录
- **设备/系统/应用版本**：
  - 设备型号：HUAWEI JER-AN20（序列号 `TNL0220A15028072`）
  - 系统版本：Android 12 (API 31)，屏幕分辨率 1080x2340 @ 480dpi
  - 应用包名：`com.yansuu1.jizhang` v0.1.0(3)
  - 已安装 APK SHA-256：`d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`（基线未重装）
- **服务端运行版本**：
  - 容器镜像：`jizhang:api-chained-choice-20261016T083118Z`
  - 镜像 SHA-256：`sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`
- **实际执行命令与记录**：
  1. `adb devices` 验证设备在线。
  2. `adb shell sha256sum` 确认 APK 字节指纹。
  3. SSH (`~/.ssh/jizhang_deploy` -> `ubuntu@jz.yansuu1.xyz`) 只读查询服务端镜像、基线代次及账本基线。
  4. 手机 UI 操作：打开会话管理 -> 点击新建对话 -> 输入只读测试 prompt -> 隐藏键盘 -> 验证就绪状态。
  5. 手机端执行 `input tap 915 2055 && sh /sdcard/capture_stream.sh`：在点击发送瞬间无缝启动真机原生 `screencap -p` 短周期循环（每 ~450ms 一帧，捕获 35 帧并在本地记录毫秒级时间戳）。
  6. 循环结束后立即 dump 终态 UI 树及全屏截屏；拉取全部 35 帧至本地；等待 3.5s 静默期后抓取静默态 UI 树与截屏。
  7. SSH 只读查询该代次 `4abe2b48-93bb-457b-b5d6-21288487cd02` 的 40 条完整 events 流水、会话消息列表与账本终态计数。
- **证据存储位置**：
  `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/visible-stream/`
  - `00-baseline.png` / `00-baseline.xml`
  - `01-device-identity.txt`
  - `02-installed-apk-sha256.txt`
  - `03-server-identity.txt`
  - `04-ledger-baseline.json`
  - `05-conv-list.png` / `05-conv-list.xml`
  - `10-new-conv.png` / `10-new-conv.xml`
  - `11-ready-state.png` / `11-ready-state.xml`
  - `12-terminal.png` / `12-terminal.xml`
  - `13-quiescent-3s.png` / `13-quiescent-3s.xml`
  - `14-server-generation-evidence.json`
  - `15-ledger-counts-final.json`
  - `stream_frames/` (包含 `cap_01.png` 至 `cap_35.png` 及 `timeline.txt`)
  - `progress.log`
  - `cap.sh`
