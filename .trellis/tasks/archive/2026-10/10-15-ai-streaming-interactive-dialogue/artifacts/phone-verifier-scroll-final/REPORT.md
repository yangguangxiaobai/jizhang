# 手机功能验收结果（滚动药丸专项 · 接续验证）

## 总体结论
**部分验证，暂不能判定达标** — 安装身份与数据保留闭环、历史长回答浏览（上滑/到底/切会话返回）无强制拉回、无药丸泄漏均达标；实时流式 pending→到底消失路径因未发新模型请求而未验证。
统计：达标 4 项；不达标 0 项；未验证 1 项。

## 验收明细
| 编号 | 验收项 | 预期结果/判定标准 | 实际结果与证据 | 结论 |
|---|---|---|---|---|
| 1 | 安装身份一致，不重装 | 当前已装 base.apk SHA256 与本地 `app-debug.apk`（5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e）字节一致；versionCode=3/versionName=0.1.0；firstInstallTime 保持 2026-10-10，未重装 | 实际 pull 当前包并核对：`33-current-base.apk` SHA256=5c004350…968e，`cmp` 本地包结果 IDENTICAL；`dumpsys package` firstInstallTime=2026-10-10 08:54:23（保留），lastUpdateTime=2026-10-17 01:04:23；pm path 与 10-postinstall 一致。证据：33-current-base.apk、52-current-pkg-times.txt、12-byte-equality.txt（历史参考） | 达标 |
| 2 | 数据保留证据闭环 | 不执行重装/清除数据；datastore 与 session 哈希与安装前后一致（仅记哈希与大小，不输出凭据值） | 本轮实测当前哈希：datastore=d7decd7d…55b4c，session prefs=eda4adc4…a4（283 bytes），与 07-preinstall/13-postinstall 完全一致。证据：52-current-data-hashes.txt 对 07-preinstall-data-hashes.txt、13-postinstall-data-hashes.txt、13b-data-preservation-summary.txt | 达标 |
| 3 | 历史长回答上滑阅读无强制拉回 | 打开已知长回答会话 f59a2d6e（150词 budgeting tips，完成态），手动上滑后视口停留在上方历史位置，不被强制拉到底；无药丸误现 | 打开成功：46-open-f59-retry.txt/xml/png 显示完整长回答＋`✓ 回答已结束 · 本轮未执行记账`，无药丸。上滑后 47-conv-swipeup1.txt/png 显示用户气泡上移至 [163,354]、露出`会话已回归待命就绪状态…`，视口保持在上方，未被拉回；全量 grep 无`跳到最新/新消息`。证据：46-open-f59-retry.*、47-conv-swipeup1.* | 达标 |
| 4 | 到底回位、切其他会话再回无旧 pill 泄漏 | 下滑回到到底与原几何一致；返回列表、打开另一会话（200词会话 d13ee42b，失败态）、再返回列表/重开 f59，全程无`有新消息，跳到最新`旧 pill 泄漏 | 下滑 48-conv-backtobottom.txt 与 46 几何一致（用户气泡 [163,480]、回答尾 [90,1864]），无药丸。切会话：49-back-to-list → 53-open-200w（另一会话，`● 生成失败`＋ASSISTANT_STREAM_BOUNDS 说明，无药丸）→ 54-back-to-list；51-open-other2 重开 f59 内容稳定无药丸。新文件全量扫描 `NONE_WITH_PILL`。证据：48-conv-backtobottom.*、49-back-to-list.*、53-open-200w.*、54-back-to-list.*、51-open-other2.* | 达标 |
| 5 | 药丸 pending=true→自然到底消失（实时流式） | 在真实流式 pending 中验证到底自动消失 | 历史浏览均为终态（f59a2d6e=completed，d13ee42b=failed），无法触发 pending；按任务约束未发起新 model 请求。JVM 单测（research/scroll-indicator-review.md §2，91 passed）不计为真机通过。此路径无真机证据。 | 未验证 |

## 不达标原因
无。

## 未验证与阻塞项
- 编号 5（实时 pending→到底消失）：历史终态会话无法触发 `newMessagesAvailable=true` 的实时 pending 条件；继续验证需一次真实受控流式生成（用户另行明确授权后才可发起，含 provider 费用/配额与超时风险），或在已有 pending 录制/可复现 streaming 会话上复测。本轮按禁令未发新 provider 请求、不做财务 confirm、不改 timeout/网络/字体。
- 会话列表纵向 swipe 6 次内容无变化（41/42 系列），属列表分页/滚动容器坐标问题，不影响结论；改用反向 swipe（44-up1~3）后定位到 f59a2d6e `当前对话`并成功打开。后续如需全量列表遍历，需限定少量历史选择或 уточнить 滚动容器坐标。
- 53-open-200w 额外观察：d13ee42b 会话呈 `● 生成失败（ASSISTANT_STREAM_BOUNDS）` 终态，属既有服务端限流/上游失败事实记录，非本专项判定项，不计入通过/失败。

## 执行环境与验证记录
- 设备/系统/应用版本：HUAWEI JER-AN20（TNL0220A15028072），Android 12（API 31），1080x2340@480dpi；应用 com.yansuu1.jizhang v0.1.0(3)；本地 APK SHA256=5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e；adb online（`adb devices` 显示 device）。
- 实际执行步骤或命令（结果）：
  - `adb devices -l` → TNL0220A15028072 device；`getprop model/version` → JER-AN20/12。
  - 核对安装：`adb shell pm path` → 08 轮同路径；`pull base.apk → 33-current-base.apk` → 1 file pulled；`sha256sum` → 5c004350…968e；`cmp 本地包 33` → IDENTICAL；`dumpsys package | grep firstInstall/lastUpdate/version` → firstInstall 2026-10-10 08:54:23 保留。
  - 启动/取证：`am start MainActivity` → delivered to running instance；`screencap`＋`uiautomator dump /sdcard/ui.xml`＋`pull`＋复用 `parse_ui.py` 生成 40/43～54 系列 .png/.xml/.txt。
  - 列表定位：上滑×6（41 系列无位移）＋下滑×8（42 系列无位移）＋反向 swipe×3（44-up1~3 定位到 f59a2d6e `当前对话`）；`tap 刷新会话列表 (192,546)` → 43。
  - 会话浏览：`tap (351,988)` 打开 f59 → 46（完成态长回答）；容器内上滑 → 47；下滑到底 → 48；`tap 会话 (816,234)` 返回列表 → 49；`tap (152,1940)` 未命中仍列表 → 50；`tap (351,1846)` 重开 f59 → 51；`tap (351,2126)` 打开 d13ee42b → 53（失败态）；返回列表 → 54。`tap (152,1080)` 一次误触（45）仍列表，无状态修改。
  - 数据闭环：`run-as sha256sum datastore/session` → 52-current-data-hashes.txt，与 07/13 一致；凭据值未输出，仅哈希＋大小。
  - 药丸扫描：`grep 跳到最新/新消息/有新消息 4*.txt 5*.txt` → NONE_WITH_PILL；`grep -c` 46/47/48/54 均为 0。
  - 未执行项（按禁令）：未重装/未卸载/未清数据；未发新 provider 请求；未做财务 confirm/记账；未改模型 timeout/网络/字体；未装依赖驱动；未做后端部署/stage/commit；未改产品源码/测试/验收标准/配置或已有原始截图（仅新增 33/40～54 与本 REPORT）。
- 证据位置（均在 `artifacts/phone-verifier-scroll-final/`，相对仓库根 `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/`）：33-current-base.apk、40-current-launch.*、41-list-swipe*、42-list-down*、43-after-refresh.*、44-up1~3.*、45-open-cur.*、46-open-f59-retry.*、47-conv-swipeup1.*、48-conv-backtobottom.*、49-back-to-list.*、50-open-other.*、51-open-other2.*、52-current-data-hashes.txt、52-current-pkg-times.txt、52b-list.txt、53-open-200w.*、54-back-to-list.*、本 REPORT.md。历史依据：00-32（00-preinstall-installed-sha256/01-device-identity/02-local-apk/04-preinstall-package-info/08-install-log/09-postinstall-package-info/10-postinstall-pm-path/11-postinstall-base-apk-sha256/12-byte-equality/13-postinstall-data-hashes/13b-data-preservation-summary/23-conversation-list/24-server-conversations.json/25-server-message-lengths.json/30-open-f59a2d6e.*）、research/scroll-indicator-review.md（JVM 91 passed 仅作背景，不计真机）。
