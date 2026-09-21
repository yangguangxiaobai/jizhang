# T2 数据模型、迁移与播种

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T1**(需要 monorepo 骨架与容器)。T3/T4/T5 依赖本任务。

## Goal

把信封预算记账所需的全部业务数据落到 SQLite:建立表结构、可重复执行的版本化迁移机制,以及首次启动时的预置数据播种(分类/默认账户/默认模板)。这是后续所有功能的数据地基。

用户价值:没有播种,新用户打开是空账本、无法记账;没有迁移机制,以后加字段就得手工改库。

## Background

- 完整 schema 设计见父任务 `design.md` §3(表定义、索引、PRAGMA 取舍)
- 字段语义的权威来源是参考项目 `lib/data/db/app_database.dart`,已逐字核对并记录在
  `../09-11-web-pwa/research/reference-project-rules.md` §3
- **本期不做同步**(父任务 D4),但保留 `updated_at` 字段便于将来扩展

## Requirements

### R1 表结构(按 design.md §3 实现)

- `users`、`sessions`、`categories`、`accounts`、`transactions`、`salary_records`、
  `budget_allocations`、`budget_templates`、`settings`、`schema_migrations`
- 所有金额列为 `INTEGER`,单位**分**(父任务 AC6)
- 所有业务表带 `deleted INTEGER NOT NULL DEFAULT 0`(软删除)
- `transactions` 的 `tags_json` 默认 `'[]'`、`is_refund` 默认 `0`
- 索引:`transactions(date DESC)`、`transactions(category_id)`、`transactions(account_id)`
- 内建常量:`builtinDefaultAccountId = 'builtin-default-account'`
  (与参考项目 `app_database.dart:10` 一致的稳定 id,便于将来迁移与去重)

### R2 连接与 PRAGMA

- 用 `better-sqlite3`
- 连接建立时设置:`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`
- 数据库文件路径来自 `DATA_DIR` 环境变量(默认 `/data`),文件名 `jizhang.db`
- 目录不存在时自动创建

### R3 迁移执行器

- 迁移文件放 `packages/server/src/db/migrations/NNN_*.sql`,按编号升序执行
- 执行前查 `schema_migrations` 已应用版本,只跑未应用的
- 每个迁移在**单个事务内**执行,失败回滚且不记录版本
- 执行迁移**前**自动备份数据库文件到 `DATA_DIR/backups/`(父任务 design.md §9)
- 迁移幂等:重复启动不重复执行(风险检查点 R2)

### R4 首次播种

- 首次启动(或库中无分类时)播种:预置分类、默认账户、默认预算模板
- **播种内容必须从参考项目 `lib/core/seed_service.dart`(18.9KB)读取后转写,不得自行编造**
- 播种必须幂等:用稳定 id,重复播种按 id 合并而非重复插入
  (参考项目有 `test/seed_dedup_test.dart` 专门验证这一点)
- 播种写入的 `updated_at` 用当前时间

### R5 数据访问层基线

- 提供类型化的查询封装,不把裸 SQL 散落到路由层
- 所有读取默认过滤 `deleted = 0`(除非显式要求包含已删除)
- 事务边界清晰:一次业务操作一个事务

### R6 测试

- 迁移执行器单测:空库 → 迁移后表齐全;重复执行 → 版本不重复、播种不重复
- PRAGMA 生效验证(至少断言 `journal_mode` 为 `wal`)
- 播种单测:两次播种后分类数量不变

## Acceptance Criteria

- [ ] AC1 空卷启动后,库中出现全部 10 张表与 3 条以上预置分类、1 个默认账户、1 个默认模板
- [ ] AC2 连续启动两次,`categories` / `accounts` / `budget_templates` 行数**不变**(播种幂等)
- [ ] AC3 `schema_migrations` 中每条迁移只有一行记录
- [ ] AC4 `PRAGMA journal_mode` 返回 `wal`;`PRAGMA foreign_keys` 返回 `1`
- [ ] AC5 迁移执行前 `DATA_DIR/backups/` 下出现备份文件
- [ ] AC6 故意写一条会失败的迁移 → 该迁移整体回滚且未记录版本,库仍可用
- [ ] AC7 单测覆盖 AC2 / AC3 / AC6,`pnpm --filter server test` 全绿
- [ ] AC8 预置分类与默认模板内容来自 `seed_service.dart`,可逐项对应(在 PR 说明里列出对照)

## Out of Scope

- 认证与会话的业务逻辑 → T3(本任务只建 `users` / `sessions` 表)
- 业务 API 端点 → T3 及之后
- 数据导出/导入 → 不做(父任务 Out of Scope)

## Technical Notes

- `sessions.token_hash` 只存 token 的 SHA-256,**不存明文**(design.md §3)
- 参考项目用 drift 的 `schemaVersion` 做迁移;Node 侧改为文件式版本化迁移,语义等价
- 参考项目老库迁移里用过"列默认值自动回填"技巧(`app_database.dart:91-92` 注释);
  本项目是空账本(D8),不需要兼容旧数据,但新加列仍应给默认值以便将来平滑升级
- 参考项目 `test/json_parse_dirty_data_test.dart` 显示脏数据容错很重要:
  JSON 字段解析失败不应让整个查询崩溃

## 必须读的文件

- `../09-11-web-pwa/research/reference-project-rules.md` §3(字段权威定义)
- `E:\.01study\Projects\flutterProjects\keepingaccounts\lib\core\seed_service.dart`(播种内容)
- `E:\.01study\Projects\flutterProjects\keepingaccounts\test\seed_dedup_test.dart`(幂等语义)
