# T6 记工资与模板管理

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T5**(预算引擎)。实现前需先读 T5 的行为规格文档。

## Goal

实现"记工资"这个预算周期的起点动作:输入工资金额,按模板比例自动生成各模块预算,允许逐项微调后保存;以及分配模板的增删改。

用户价值:这是信封预算法的入口。用户每月发薪后记一次工资,整个月的各类预算就自动就位。

## Background

- 语义:参考项目 `app_database.dart:110` 注释 —— **"每次记录工资 = 新预算周期的起点"**
- `budget_allocations` 的 `id` 注释明确为 **"= 预算周期 id"**(`app_database.dart:124`)
- 模板 = 模块列表,每个模块是 `(categoryId, ratio)`(`budget_template.dart:71-85`)
- 相关参考源码:
  - `lib/features/budget/salary_entry_page.dart`(22.8KB)
  - `lib/features/budget/salary_allocation_validation.dart`
  - `lib/features/template/template_validation.dart`
  - `test/salary_allocation_validation_test.dart` / `test/template_validation_test.dart`

## Requirements

### R1 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/salaries` | 工资记录列表(倒序) |
| GET | `/api/v1/salaries/:id` | 详情,含各模块分配明细 |
| POST | `/api/v1/salaries` | 记工资(可带微调后的 allocations) |
| PATCH | `/api/v1/salaries/:id` | 编辑金额/日期/备注 |
| DELETE | `/api/v1/salaries/:id` | 软删除(**同时软删关联的 budget_allocations**) |
| GET | `/api/v1/templates` | 模板列表 |
| POST | `/api/v1/templates` | 新建模板 |
| PATCH | `/api/v1/templates/:id` | 编辑(名称/模块/比例) |
| DELETE | `/api/v1/templates/:id` | 软删除 |
| POST | `/api/v1/templates/:id/default` | 设为默认模板 |

### R2 按比例分配金额

- 请求:`{ amountCents, date, note, templateId?, allocations? }`
- 未传 `allocations` 时:按 `templateId`(缺省用默认模板)的比例计算各模块金额
- **余数处理已查证定案**(见 `../09-11-web-pwa/research/reference-project-rules.md` §10.1):
  除最后一个模块外,金额 = `round(工资 * ratio)`;
  **最后一个模块 = 工资额 − 已分配之和**(吸收取整误差)。
  因此各模块之和**恒等于**工资额。
  - ⚠️ 这里的"最后一个"是**模板模块列表的顺序末位**,不是比例最大的那个
  - ⚠️ 已知边界:若末位吸收的剩余 ≤ 0(极小金额或极端比例),校验会拒绝保存。
    本项目**照实复刻**该行为并用测试固定,不自行改成"分配 0 分"
- 传了 `allocations` 时:以传入值为准(**这就是"微调"路径**),
  但仍需校验**各模块之和恰好等于工资额**(差额报错)

### R3 模板与比例校验

- 比例用小数存储(如 `0.4` = 40%),与参考项目 `TemplateModule.ratio` 一致
- **校验规则已查证定案**(`research/reference-project-rules.md` §10.2 §10.3):
  - 比例和 ≈ 100%,容差 **`1e-4`**(`(totalRatio - 1).abs() < 0.0001`)
  - 每个模块 `ratio` 必须 `isFinite && > 0`
  - 每个模块 `categoryId` 非空
  - 同一模板内**不允许重复 `categoryId`**(`ids.length === modules.length`)
- 元→分转换必须用 `Math.round`(`parsePositiveCents` 用的是 `.round()`,PRD §R2 的 AC6 依据)

### R4 工资记录与分配的关系

- 记一次工资 = 创建 1 条 `salary_records` + 1 条 `budget_allocations`
- `budget_allocations.salary_record_id` 指向该工资记录
- `budget_allocations.date` = 周期起始(发薪日)
- 同一周期(自然月或配置周期)内多次记工资 → 创建**多条** `budget_allocations`,
  由 T5 的引擎在计算时按周期合并(引擎已有此语义,不要在这里做合并)
- 编辑工资金额时,是否同步重算 allocations?**需定案**:若用户已微调过则不覆盖。
  建议:编辑金额时保留原 allocations(PATCH 只改工资记录本身),重算走单独接口或前端提交新 allocations

### R5 周期起始日设置

- `settings['budget.cycle_start_day']` = `{"day": 15}`
- 合法范围 **1..28**(参考项目 `test/budget_prefs_test.dart:27,30` 专门测了 `0` 与 `29` 的非法值)
- 未设置 = 自然月模式
- 通过 `/api/v1/settings` 读写;该值传给 T5 引擎的 `cycle`

### R6 测试

- 按比例分配:10000 元 + 模板 40/30/30 → 4000/3000/3000
- 余数场景:工资额不能被比例整除时的分配结果(用参考实现的定案行为做断言)
- 微调路径:请求带 `allocations` 时以传入值为准
- 比例和 ≠ 100% 被拒
- 重复 `categoryId` 被拒
- 删除工资记录时关联 allocations 一并软删
- `cycle_start_day` 越界(0 / 29)被拒

## Acceptance Criteria

- [ ] AC1 工资 10000 元 + 模板 40/30/30 → 三个模块分别为 4000/3000/3000 元(400000/300000/300000 分)
- [ ] AC2 请求带微调 `allocations` 时,入库为微调值,不按比例覆盖
- [ ] AC3 各模块金额之和**恒等于**工资额;末位模块吸收取整误差
      (用例:工资 10000 分 + 模板 0.33/0.33/0.34 → 3300/3300/3400;工资 101 分 + 同模板 → 33/33/35)
- [ ] AC4 比例和超出容差 `1e-4` → 400(如 0.40+0.30+0.20 = 0.90 被拒;0.33333×3 通过)
- [ ] AC5 模板内重复分类 → 400
- [ ] AC6 删除工资记录后,其 `budget_allocations` 也被软删,且 T5 引擎不再计入
- [ ] AC7 `cycle_start_day` 设为 15 → T5 引擎按 15 号边界计算;设为 0 或 29 → 400
- [ ] AC8 同月记两次工资 → 产生两条 `budget_allocations`,引擎计算时模块预算相加(AC7 与 T5 的 S1 用例一致)
- [ ] AC9 设为默认模板后,新记工资不传 `templateId` 时使用该模板
- [ ] AC10 `pnpm --filter server test` 全绿

## Out of Scope

- 预算页 UI 的图表化展示 → 随 T5/T6 交付基础版;复杂图表归 T8
- 年度储蓄目标、预算增强 → 父任务 MVP 范围外
- 周期账单自动生成工资 → 不做

## Technical Notes

- **余数处理是本任务最需要查证的一点**。参考项目里有明确实现,不要发明。
  若查证后发现参考实现未处理(各模块之和 ≠ 工资),则需向用户提出并定案后再实现
- `budget_allocations.allocations` 存 JSON(`[{"categoryId","amountCents"}]`),
  参考项目 `salary_budget.dart:81-90` 的 `toJson` 只序列化这两个字段(不含 ratio)
- 参考项目模板的 `isDefault` 是单值语义:设为默认时应把其他模板的 `isDefault` 置为 false
- 验证比例与分配的前端校验逻辑(元/分转换、实时预览)也需要交付最基本版本,
  以保证用户能完成"记工资"闭环
