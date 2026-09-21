# 实现计划：微信 / 支付宝账单导入

## 前置

- [ ] 用户将脱敏样例放入：
  - `packages/server/test/fixtures/wechat-bill-sample.csv`
  - `packages/server/test/fixtures/alipay-bill-sample.csv`
- [ ] 无样例时先用 `fixtures/wechat-constructed.csv`、`alipay-constructed.csv`

## 阶段 1 — shared 解析器

- [x] 1.1 `packages/shared/src/platform-bills.ts`
  - [x] 编码探测 + decode（server `bill-decode.ts`）
  - [x] `detectPlatformBillSource(text)`
  - [x] `locateHeaderRow` / 列别名
  - [x] `parsePlatformBills(text, opts)` → rows + stats
  - [x] 金额/时间解析
  - [x] 过滤 `ignoreReason`
  - [x] `categorizeBill()` 关键字表
  - [x] `platformBillId()`
- [x] 1.2 导出 `shared/src/index.ts`
- [x] 1.3 `shared/test/platform-bills.test.ts`
- [x] 1.4 `pnpm --filter @jizhang/shared test` 全绿

## 阶段 2 — server API

- [x] 2.1 确认 `accounts` 同名/软删策略（读 schema + master-data）
- [x] 2.2 `ensureAccount` / `ensureCategory`（事务内）
- [x] 2.3 `importPlatformBills(csv, { source, dryRun })` in portability
- [x] 2.4 路由 `POST /api/v1/import/platform-bills`（CSRF、401、400）+ octet-stream parser
- [x] 2.5 `server/test/platform-import.test.ts`
- [x] 2.6 `pnpm --filter @jizhang/server test` 全绿（含旧 portability）

## 阶段 3 — Web

- [x] 3.1 `client.ts`：`importPlatformBills`（原始字节）
- [x] 3.2 `DataView.vue`：模式、accept、dry-run 预览、结果展示
- [x] 3.3 typecheck / lint / web build 审计

## 阶段 4 — 真实样例对齐

- [x] 4.1 用用户文件跑解析，修列名/过滤（GBK、长表头、对方已收钱、收入提现）
- [x] 4.2 真实结构 fixture（`wechat-bill-sample.csv` / `alipay-bill-sample*.csv`）

## 阶段 5 — 文档与交付

- [x] 5.1 USAGE.md 导出步骤 + 过滤说明
- [x] 5.2 README 功能与 API
- [x] 5.3 全量 build（shared/server 测试 + web typecheck/lint/build + server build 已绿）
- [x] 5.4 用户确认后 commit + 部署（镜像 `jizhang:2026-09-18-platform-import`，https://jz.yansuu1.com healthy）

## 验证命令

```bash
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/server test
pnpm --filter @jizhang/web typecheck && pnpm --filter @jizhang/web lint
pnpm build
```

## 回滚

- 仅新增端点与 UI 模式，不改既有 CSV 导入；回滚 = 还原代码版本，无数据迁移。
- 误导入数据：应用内删除或回收站清空；必要时 CLI restore 备份。
