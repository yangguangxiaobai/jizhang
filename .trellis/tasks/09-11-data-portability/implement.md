# 数据导出与导入 — 执行计划

> 前置阅读:`prd.md` → `design.md`。

## 阶段 0:前置核实

- [ ] 0.1 读 `cli-db.ts:114-160`,确认 `createBackup` 的签名、备份文件名格式与保留期语义
- [ ] 0.2 读 `config.ts`,确认 `dataDir` 如何暴露(备份目录 = `<dataDir>/backups`)
- [ ] 0.3 读 `app.ts` 的 body 限制设置,确认文本正文上传的上限,并决定是否需要为该路由单独放宽
- [ ] 0.4 读 `utils/money.ts` 的 `formatCents` / `fromDateInputValue`,确认导出/导入复用它们而不是自写
- [ ] 0.5 确认 Fastify 是否能直接 `reply.type('text/csv')` 并在 `/api/**` 下返回非 JSON——注意 `spec` 规定 `/api` 不得返回 HTML,但 CSV 不是 HTML;若无先例,在 design.md 记录该决定
- [ ] 0.6 检查导出路由是否会受既有 `onSend` 的 `no-store` 钩子影响(它按 `/api` 前缀命中,**导出响应也会被标记 no-store,这是正确的**——不该被缓存)

## 阶段 1:shared —— CSV 编解码

- [ ] 1.1 新增 `packages/shared/src/csv.ts`:`encodeCsvField` / `encodeCsv` / `parseCsv`
- [ ] 1.2 `index.ts` 导出
- [ ] 1.3 单测 `test/csv.test.ts`:
  - 含逗号、双引号、换行、前后空格的字段编码后能原样解析回来(往返)
  - 解析引号字段内的逗号与换行
  - `""` 转义为一个双引号
  - CRLF 与 LF 混用
  - 结尾无换行
  - 空行与空字段
  - **一个含逗号的备注不会让列数变化**(AC3 的核心)
- [ ] 1.4 `pnpm --filter @jizhang/shared test` 全绿
- [ ] 1.5 **构建 shared**(`pnpm --filter @jizhang/shared run build`)——服务端 import 的是 dist

**回滚点 R1:** 纯新增文件。

## 阶段 2:服务层 `PortabilityService`

- [ ] 2.1 导出账单 CSV:BOM + 表头 + 每行;金额用整数算法生成;`type`/`isRefund` 人类可读
- [ ] 2.2 导出工资 CSV(含分配明细)、周期规则 CSV
- [ ] 2.3 导入账单 CSV:
  - 解析 → 逐行校验 → **单事务**插入
  - 按 `id` 去重(已存在则跳过)
  - 按**名称**解析分类/账户,找不到则整份拒绝并指出名称
  - 日期按**本地日**解析
  - 返回 `{ inserted, skipped, total }`
- [ ] 2.4 备份列表:读 `<dataDir>/backups`,返回 `{ fileName, sizeBytes, createdAtMs }`(**不返回绝对路径**)
- [ ] 2.5 触发备份:调用既有 `createBackup`,沿用默认保留期
- [ ] 2.6 单测(重点):
  - **往返**:导出 → 清库 → 导入 → 账单条数与净支出合计一致(AC2/AC4)
  - **幂等**:连续导入两次,第二次 `inserted=0` 且 `skipped=N`(AC5)
  - 金额非法 → 明确报错(AC6)
  - 缺列 → 明确报错(AC6)
  - 未知分类名 → 明确报错并指出名称(AC7)
  - **只新增**:导入前记录既有账单的 id/金额/备注,导入后逐字段不变(AC8)
  - 含逗号/换行备注的往返(AC3)
  - CSV 前三个字节是 `EF BB BF`(AC1)
- [ ] 2.7 `pnpm --filter @jizhang/server test` 全绿

**回滚点 R2:** 新增服务文件。

## 阶段 3:路由

- [ ] 3.1 新增 `routes/portability.ts`,6 个端点(design.md §6.1)
- [ ] 3.2 注册进 `app.ts` 的 `authModule.extraRoutes` **数组内**
- [ ] 3.3 单测:6 个端点未认证一律 401(带 CSRF 头);文件上传超限返回明确错误
- [ ] 3.4 `pnpm -r run lint`、`pnpm -r run typecheck`

## 阶段 4:前端

- [ ] 4.1 `api/client.ts`:`portability` 命名空间;导出用 `<a download>` 而非 fetch(避免把整个 CSV 读进内存)
- [ ] 4.2 `views/DataView.vue`:导出区 / 导入区 / 备份区
  - 导入:选文件 → **显示将发生什么** → 确认 → 结果统计
  - 备份:列表 + 触发按钮 + 可复制的恢复命令行指引
  - 空备份状态
- [ ] 4.3 `router/index.ts` 新增 `/data`;`SettingsView.vue` 新增入口
- [ ] 4.4 只用既有 CSS 语义变量;所有控件 ≥ 44px(包含文件选择与按钮)

## 阶段 5:端到端验证

- [ ] 5.1 新增 `scripts/e2e-portability.mjs`(AC1–AC10)
- [ ] 5.2 新增 `scripts/render-data.mjs`(AC12;复用 `lib/browser.mjs`,自身重置容器基线)
- [ ] 5.3 重建镜像并 `--force-recreate`,**重新 cp 脚本**
- [ ] 5.4 容器内跑全部套件,确认既有 435 项零回归;**用不同顺序跑两遍**

## 阶段 6:收尾

- [ ] 6.1 全量质量门
- [ ] 6.2 更新 spec:
  - BOM 与 Excel 的实测结论
  - 去重键用 `id` 的理由与已知局限
  - 导入全成或全不成;未知分类明确失败而不自动创建
  - **UI 不提供恢复**及其理由
  - 备份列表不返回宿主路径
- [ ] 6.3 勾选 AC1–AC13 并写证据
- [ ] 6.4 按 Phase 3.4 提交

## 验证命令速查

```bash
pnpm --filter @jizhang/shared run build
pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test
pnpm --filter @jizhang/web run build
docker compose build && docker compose up -d --force-recreate
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-portability.mjs
node packages/web/scripts/render-data.mjs out.png
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| 导入丢数据(最不可接受) | `id` 去重 + 全成或全不成 + 只新增断言 | R2 |
| CSV 转义不完整,一条含逗号的备注毁掉整份文件 | 往返单测逐条覆盖逗号/引号/换行 | R1 |
| Excel 中文乱码 | BOM + 断言前三个字节 | R2 |
| 日期整体偏移一天 | 按本地日解析,复用 `fromDateInputValue` 口径;跨时区单测 | R2 |
| 未知分类导致静默丢弃 | 明确失败并指出名称;单测断言报错而非静默 | R2 |
| 导出响应被 `no-store` 钩子影响 | 这是**正确**行为(导出不该被缓存);在 3.3 里断言它仍能正常下载 | — |
| 大文件超出 body 限制 | 阶段 0.3 先确认上限;超限返回明确错误而不是截断 | — |
