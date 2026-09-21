# 设计：微信 / 支付宝账单导入

## 架构位置

```
packages/shared/src/platform-bills.ts   # 纯解析：识别来源、表头、行→中间 DTO、关键字分类
packages/server/src/services/portability-service.ts  # 或独立 platform-import-service.ts
packages/server/src/routes/portability.ts            # POST /import/platform-bills
packages/web/src/views/DataView.vue                  # 导入 UI
packages/server/test/platform-bills.test.ts          # 单测
packages/server/test/fixtures/wechat-*.csv
packages/server/test/fixtures/alipay-*.csv
```

解析放在 `shared`：无 IO、可测、前后端理论上都能预览（v1 预览也可仅前端调 API dry-run）。

## 解析管线

```
raw bytes/text
  → detectEncoding (BOM | UTF-8 validate | GBK fallback)
  → decode to utf-8 string
  → strip BOM
  → detectSource(header lines + body keywords)
  → locateHeaderRow (扫描前 30 行，匹配已知列名集合)
  → parseCsv rows
  → mapRow(source, row) → ParsedBillRow | IgnoreReason
  → categorize(note, sourceCategory)
  → toTransactionDraft
```

## 来源识别启发式

| 信号 | 来源 |
|------|------|
| 含「微信支付账单」「交易单号」且表头有「当前状态」/「支付方式」 | wechat |
| 含「支付宝」「交易订单号」「交易分类」 | alipay |
| 表头含 `id,date,type,amount,category,account` | jizhang-transactions |
| 否则 | unknown → ValidationError |

## 行映射要点

### 微信（典型）

- 时间：`2026-09-10 12:01:02` → `fromDateInputValue('2026-09-10')` 或 component 构造本地 00:00
- 收/支：`支出` / `收入` / `其他` → `其他` 跳过或进 ignored
- 金额：`¥8.00` → 800
- 单号：`交易单号`
- 状态：`支付成功` / `已全额退款` / …
- note：优先 `商品`，否则 `交易对方`

### 支付宝（典型）

- 时间列：`2026-09-10 12:01:02`
- 分类列：`交易分类` 参与关键字
- 金额列：`金额` 或 `金额（元）`
- 单号：`交易订单号`
- 收/支：`支出`/`收入`/`不计收支` → 后者 ignored

列名别名表放在 `shared/platform-bills.ts` 常量，便于样例到来后扩展。

## 去重 ID

```
wx-${traderOrderId}
ali-${tradeOrderId}
sha1-${sha1(`${source}|${isoTime}|${type}|${cents}|${note}`).slice(0, 24)}
```

写入 `transactions.id`；应用原生 UUID 导入不受影响。

## 写入路径

两种可选：

**A. 复用 TransactionService.create**（逐行）  
- 优点：校验/账户/分类路径统一  
- 缺点：平台行可能缺 category id；需要先 resolve/创建账户与分类

**B. 与现有 importTransactionsCsv 相同：直接 SQL INSERT（事务）**  
- 优点：快、与 T15 风格一致  
- 缺点：绕过部分 service 校验

**定案：B**（事务批量 INSERT），账户/分类在事务内 ensure。

## 分类 resolve

```
ensureCategory(name, type) → id
  找 live 分类 name+type → 否则 INSERT（非 builtin，排序靠后）
```

关键字映射命中的分类名必须是**种子分类名**（餐饮/交通/…/其他/工资/退款/其他收入），
不自动建奇怪分类。未命中 →「其他」或「其他收入」。

**退款收入**：note 含「退款」→ 分类「退款」，`type=income`，`is_refund=0`（v1 不自动关联）。

## 账户 ensure

```
ensureAccount('微信') / ensureAccount('支付宝')
```

- 若存在（含已软删除？）**v1：只找 deleted=0**；软删则新建同名（账户表允许同名吗？）
- 查 `accounts` 是否有同名约束 → design 实现前看 schema；若唯一则用 `微信2` 不优雅
- **更好**：同名 soft-deleted → restore；无则 insert
- 初始余额 0

## API 形状

`POST /api/v1/import/platform-bills`

- `Content-Type: text/csv`
- `?source=auto|wechat|alipay`（默认 auto）
- 会话 + CSRF（写操作）
- bodyLimit 与现有 import 相同

响应 `PlatformImportResult`：

```ts
{
  source: 'wechat' | 'alipay';
  inserted: number;
  skipped: number;   // 已存在 id
  ignored: number;   // 过滤规则命中
  total: number;     // 数据行总数
  accountsCreated: string[];
  categoriesCreated: string[];
  dateFrom?: string;
  dateTo?: string;
  expenseCents: number;
  incomeCents: number;
}
```

## Dry-run 预览

`POST /api/v1/import/platform-bills?dryRun=1`  
只解析不写库，返回统计 + 前 20 行样本（note/date/type/amount/category）。  
UI 选文件后先 dryRun，用户确认再实导。

## 编码

1. 剥 UTF-8 BOM  
2. `TextDecoder('utf-8', { fatal: true })` 失败则  
3. GBK：评估 `iconv-lite`（体积小）或只支持 UTF-8 + 错误提示「请另存为 UTF-8」  
   **倾向**：引入 `iconv-lite`（仅 server/shared 依赖），否则用户每次要转码体验差  
4. 检测到 GBK 时在结果 warnings 里说明

## 过滤实现

```ts
function ignoreReason(row, source): string | null
```

返回 null 表示导入。规则见 PRD R6，常量关键词列表可调。

## 前端

DataView `importMode` 扩展：

```ts
type ImportMode =
  | 'auto' | 'wechat' | 'alipay'
  | 'transactions' | 'transfers';
```

- mode 为平台类 → `importPlatformBills(text, source)`
- dryRun 结果展示卡片
- 提示文案 + 链到 USAGE

`client.ts`：

```ts
portability.importPlatformBills(csvText, source?: 'auto'|'wechat'|'alipay', dryRun?: boolean)
```

## 测试计划

| 文件 | 覆盖 |
|------|------|
| `shared/test/platform-bills.test.ts` | 列名别名、金额解析、过滤、分类关键字、去重 id |
| `server/test/platform-import.test.ts` | API 401/400/dry-run/实导/二次导入/账户创建/事务回滚 |
| fixtures | 构造 + 用户真实样例（脱敏） |

## 风险

| 风险 | 缓解 |
|------|------|
| 平台改列名 | 别名表 + 明确错误列出「未找到列」 |
| GBK 依赖 | iconv-lite 或文档要求 UTF-8 |
| 误导入还款/转账 | 过滤关键词 + ignored 统计可核对 |
| 分类不准 | 全落可改分类；关键字表独立可调 |
| bodyLimit | README/错误提示写清 |

## 实现顺序

1. `shared/platform-bills.ts` + 单测（构造 fixture）  
2. server service + route + 测试  
3. DataView + client  
4. 用户真实样例对齐  
5. 文档 + 部署  
