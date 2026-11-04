# 手机功能验收结果（Stop 专项）

## 总体结论
**达标** — 在真机与在线后端生产环境上，成功在首字等待占位期间（TTFT 阶段）明确点击 Stop 按钮；客户端立即进入并维持“已停止生成（未执行记账）”终态；服务端代次状态确认为 `cancelled`，未下发任何 `text-delta` 或正文消息；终态后 3 秒静默期内无任何迟到卡片或待确认事项，账本与待确认队列零变更。  
统计：达标 6 项；不达标 0 项；未验证 0 项。

## 验收明细

| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 前置环境与已安装版本校验 | 设备在线且前台可操作；APK 保持为 `d2a37b55` 未重装；后端运行含 `31bb967e` 镜像 | 设备 `TNL0220A15028072` (JER-AN20 / Android 12) 在线且位于前台；已装 APK SHA-256 为 `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`；后端镜像为 `sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b` — 证据：`00-baseline.png`、`09-installed-apk-sha256.txt`、`10-server-identity.txt` | 达标 |
| 2 | 新建显式测试对话与请求输入 | 新建独立测试对话，发送 1 条只读 400 字预算建议请求（明确标注仅阅读、不记账） | 创建会话 `c0d9126a-6dd4-41a3-9f0c-341b652503bd`，发送输入：`UI TEST: Please provide 400 words of budget planning advice for young professionals. Reading advice only do not book any transaction.` — 证据：`02-new-conv.png`、`03-typed.xml`、`05-ready-state.xml` | 达标 |
| 3 | 首字等待占位期间 Stop 明确可用并成功点击 | 发送后首字未到达前（TTFT 阶段），占位气泡或底部显示明确 Stop 按钮，且在首字到达前成功点击 | 发送后约 0.5s~1.1s 内，首字尚未到达，UI 显示占位气泡与“停止生成”按钮；在首字返回前于 +1.103s 成功点击 Stop 按钮；零 delta、无迟到文字片段 — 证据：`06a-connecting-placeholder.png`、`06b-stop-clicked.png`、`progress.log` | 达标 |
| 4 | UI 明确反馈已停止与免记账提示 | 点击 Stop 后，界面状态转为停止终态，明确提示已停止且未记账；不出现任何财务 confirm 对话框 | 顶部状态栏显示 `● 已停止生成`，气泡显示 `● 已由用户手动停止生成（未执行记账）`；底部输入框恢复可用；无任何二次确认或财务 confirm 弹窗 — 证据：`06-stop-clicked.xml`、`06b-stop-clicked.png` | 达标 |
| 5 | 服务端代次终态与事件序列验证 | 通过只读 SSH 查询匹配测试代次，确认 `status=cancelled`，事件 Contiguous 且仅包含 accepted -> running -> cancelled | 代次 `dc9da3e7-1676-40aa-aed1-697eb04f849d` 状态为 `cancelled`，`outcome=null`，`error_code=ASSISTANT_GENERATION_CANCELLED`；事件共 3 条（seq=1 state:accepted，seq=2 state:running，seq=3 terminal:cancelled）；无任何 `text-delta` 事件，无 assistant message 产生 — 证据：`08-server-generation-evidence.json` | 达标 |
| 6 | 终态后 3s 静默与账本零影响 | 终态达到后等待 3 秒以上，无迟到的卡片/pending action 注入，账本记录表零变动 | 终态后等待 3.5s 重新抓取 UI 树，节点与文字完全一致，无迟到卡片；服务端 `transactions` 总数维持 59、`assistant_pending_actions` 总数维持 11，未发生任何记账写入 — 证据：`07-terminal-quiescent-3s.png`、`07-terminal-quiescent-3s.xml`、`11-ledger-counts.json` | 达标 |

## 不达标原因
无。

## 未验证与阻塞项
无。

## 执行环境与验证记录
- **设备/系统/应用版本**：
  - 设备：HUAWEI JER-AN20 (`TNL0220A15028072`)
  - 系统：Android 12 (API 31)，分辨率 1080x2340 @ 480dpi
  - 应用包名：`com.yansuu1.jizhang` v0.1.0(3)
  - 已安装 APK SHA-256：`d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`（基线未重装）
- **服务端运行版本**：
  - 容器镜像：`jizhang:api-chained-choice-20261016T083118Z`
  - 镜像 SHA-256：`sha256:31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`
- **实际执行命令与记录**：
  1. `adb devices -l` 验证设备在线。
  2. `adb shell pm path com.yansuu1.jizhang` + `sha256sum` 确认 APK 字节指纹。
  3. SSH 只读查询服务端容器状态、生成记录基线与账本基线。
  4. 手机 UI 自动化操作：导航至会话管理 -> 点击新建对话 -> 输入 400 字建议测试 prompt -> 收起键盘 -> 点击发送 -> 0.6s 首字等待占位期间截屏 -> 1.1s 明确点击 Stop 按钮 -> 抓取停止瞬间 UI 与 XML -> 等待 3.5s 抓取静默期 UI 与 XML。
  5. SSH 只读查询最新匹配代次 `dc9da3e7-1676-40aa-aed1-697eb04f849d` 的完整状态、事件流水、消息列表与账本计数。
- **证据存储位置**：
  `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/stop/`
  - `00-baseline.png` / `00-baseline.xml`
  - `01-conv-list.png` / `01-conv-list.xml`
  - `02-new-conv.png` / `02-new-conv.xml`
  - `03-typed.png` / `03-typed.xml`
  - `04-keyboard-hidden.png` / `04-keyboard-hidden.xml`
  - `05-ready-state.png` / `05-ready-state.xml`
  - `06a-connecting-placeholder.png`（首字等待占位截屏）
  - `06b-stop-clicked.png` / `06-stop-clicked.xml`（点击 Stop 后即时状态）
  - `07-terminal-quiescent-3s.png` / `07-terminal-quiescent-3s.xml`（终态后 3s 静默验证）
  - `08-server-generation-evidence.json`（服务端代次与事件数据）
  - `09-installed-apk-sha256.txt`（设备 APK SHA-256）
  - `10-server-identity.txt`（服务端镜像与启动时间）
  - `11-ledger-counts.json`（账本行数无变化证明）
  - `progress.log`（端到端执行时间戳记录）
