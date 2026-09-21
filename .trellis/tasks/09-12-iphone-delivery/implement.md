# Implementation / verification

- [x] 1. 添加预算完整性回归并观察失败；修复当前、历史、结余池与趋势共用口径。
      → `packages/shared/test/budget-completeness.test.ts`；`spentBetween` 换成
      `moduleViewsInWindow`，当前视图 / 结余池 / 结余池趋势三处不再各抄一份口径。
- [x] 2. 添加工资修改原子性回归；修复金额校验、日期同步与快照写入。
      → `packages/server/test/budget.test.ts`；改金额必须同时提交配平分配，
      改日期时快照日期同事务跟进，`Number.isSafeInteger` 取代 `Number.isInteger`。
- [x] 3. 删除 PIN 功能及相关死代码，保留登录与现有配色。
      → `useLock.ts` / `LockScreen.vue` 删除，`AppShell` 与设置页入口移除；
      `dist/` 产物内已无 `jizhang.pin` / 应用锁字符串（grep 验证）。
- [x] 4. 建立隔离浏览器主流程测试，覆盖用户实际表单、刷新及小屏布局；修复发现的真实缺陷。
      → `packages/web/e2e/`（Playwright，每用例自建 HTTP 监听 + 临时库）。
      首次运行即抓到 3 个产品缺陷：离线横幅不响应请求失败、`.link` 按钮实测 43.2×44px、
      零预算模块谎报"已用 100%"。均已修复。
- [x] 5. 跑 lint / typecheck / test / build / 手机、动效、配色与 PWA 审计；浏览器回归与 API 全流程。
      → 见下方 §验证证据。
- [x] 6. 更新用户指南、部署/交付说明、相关可执行规范与验收记录。
      → 新增 `USAGE.md`；`README.md` 重写（原内容仍停留在 T1 骨架时期，称"只有健康检查接口"）；
      `.env.example` 的 T3 占位注释修正；`frontend/index.md` 与
      `frontend/component-guidelines.md` 中指向已删除文件的规范漂移修正。
- [x] 7. 检查 diff、确认真实账本与既有改动未损伤，逐项核对 A1–A8 后交付。
      → 见 §A1–A8 核对。配色工作全程保留（`09-12-color-system` 单独成提交）。

## Commands

```bash
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/server test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

浏览器命令（隔离运行器落地后）：

```bash
# 每个用例自建 HTTP 监听与临时数据库，不使用对 live data 有破坏性的 e2e-reset
pnpm test:iphone:only                 # 需要 npx playwright install
# 本网络下载不到 Playwright 浏览器时，退回本机 Chrome 跑 chromium 项目：
JIZHANG_E2E_CHANNEL=chrome pnpm test:iphone:only
```

## §验证证据（2026-09-13）

| 层次 | 结果 |
|---|---|
| `pnpm lint` / `pnpm typecheck` | 三个包全通过（exit 0） |
| `pnpm test` | shared **125** + server **336** = **461** 全通过 |
| `pnpm build` + 四项静态审计 | 移动端 8 + 动效 10 + 配色 48 + PWA 34 = **100 项断言全通过，0 失败** |
| 容器 e2e（12 套件） | **498 项**全通过 |
| 浏览器实测（7 套件） | **338 项**全通过（含 `render-color` 131 项） |
| iPhone 隔离 e2e（Playwright） | **4 个用例**全通过 |

提交：`9bc5a42`（配色系统，已单独验证 lint 与四项审计通过）、
`210fc66`（本任务：删除 PIN、两处记账修复、隔离浏览器回归）。

## §A1–A8 核对

- **A1** ✅ PIN 从源码与构建产物移除；携带旧 `jizhang.pin` 不阻止使用（`iphone.spec.mjs`
  播种一条旧记录并断言应用照常加载、设置页无锁定控件）；认证仍有效。
- **A2** ✅ 浏览器实测：设模板 → 录工资 10000.01 → 预览配平 → 保存，模块 `6000.01 / 4000.00`
  逐分等于工资；重启服务后刷新仍为 `11000.01`（持久化）。
- **A3** ✅ 支出、改分类、退款、删除、恢复逐项实测反映到正确模块；
  **模板外支出不再消失**（购物显示"未分配预算"、`-50.00`，并进入结余池 `-50.00`）。
- **A4** ✅ 同月两笔工资合并（`1000001 + 1000000 = 1100001`）；跨周期历史与结余池一致
  （`85000`），模板外支出计入历史窗口。
- **A5** ✅ 改金额必须同时提交配平分配，否则拒绝；改日期同步快照；写入在单事务内。
  服务端单测覆盖；**注意**：Web 端目前没有编辑工资的入口，这两个客户端方法暂无调用者。
- **A6** ✅ iPhone 视口（375/390/430）逐页实测：无横向溢出、控件 ≥44px、输入 ≥16px、
  有安全区；登录页与设置页均验证。
- **A7** ✅ 全部质量门通过（上表）。**局限已记录**：Playwright 浏览器在当前网络下载失败
  （`Chrome for Testing … Download failure`），因此实际运行的是**本机 Chrome 的 chromium
  引擎**；`webkit-iphone` 项目从未运行过，而它才是最接近 iOS Safari 的那一层。
- **A8** ✅ README 重写、新增 `USAGE.md`、补本验收记录，均与最终源码逐项核对
  （文档中的 65 个端点、12 个 e2e 套件、7 个浏览器套件、11 个根脚本、目录结构均已机械校验）。
  **未声称**任何真机或线上验收——尚未部署，也无真实 iPhone 测试。

## Baseline / approval

基线 `08e612d`，dirty tree 已核验；用户"开始"批准本任务摘要（2026-09-12）。
用户于 2026-09-13 决策：保留"添加到主屏幕"提示；README 修正 + 新增用户说明。
失败时仅回滚本任务的对应局部编辑，不执行 git reset / clean / 全文件恢复。
