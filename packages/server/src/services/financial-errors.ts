/**
 * 财务执行(Phase 1)的 HTTP 错误词汇表。
 *
 * 每一个类都只带 `statusCode` + 稳定的 `code`,由 `app.ts` 的统一错误处理器
 * 转成 `{ error: { code, message } }`。**消息里不出现任何金额或来源内容**:
 * 这些是用户隐私,而错误只需要说明"服务端为什么拒绝"。
 *
 * 单独成文件的原因:重放存储(`financial-operation-store.ts`)和退款生命周期
 * (`financial-source-lifecycle.ts`)不依赖 `transaction-service.ts`,否则会和
 * 那个模块形成循环导入。错误类放这里,三方都能安全引用。
 *
 * 契约(`10-27-financial-execution-phase1/contract.md` "Replay / errors"):
 * - 400 FINANCIAL_INVALID
 * - 404 NOT_FOUND
 * - 409 FINANCIAL_REVISION_CONFLICT / FINANCIAL_SOURCE_CHANGED / FINANCIAL_WINDOW_CONFLICT /
 *   FINANCIAL_SOURCE_ALREADY_INCLUDED / FINANCIAL_OPERATION_MISMATCH /
 *   FINANCIAL_REFUND_CONFLICT / FINANCIAL_DISABLED
 * - 503 FINANCIAL_UNAVAILABLE(库里存的事实坏到无法解释)
 */

/** 400 —— 请求本身不合法(缺字段、非整数分、越界枚举、未知筛选值)。 */
export class FinancialInvalidError extends Error {
  readonly statusCode = 400;
  readonly code = 'FINANCIAL_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialInvalidError';
  }
}

/** 404 —— 明确"没有这个资源"。绝不回退到"当前周期"之类的猜测。 */
export class FinancialNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'The requested financial resource does not exist.') {
    super(message);
    this.name = 'FinancialNotFoundError';
  }
}

/** 409 —— `expectedRevision` 与当前修订号不一致(别的写入先发生了)。 */
export class FinancialRevisionConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_REVISION_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialRevisionConflictError';
  }
}

/** 409 —— 来源事实(金额/日期/账户/删除)已经变了,或来源 token 对不上。 */
export class FinancialSourceChangedError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_SOURCE_CHANGED';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialSourceChangedError';
  }
}

/** 409 —— 窗口冲突:与已确认窗口重叠,或组与配置不一致,需显式对账。 */
export class FinancialWindowConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_WINDOW_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialWindowConflictError';
  }
}

/** 409 —— 同一笔工资被要求同时包含在另一个活跃周期里。 */
export class FinancialSourceAlreadyIncludedError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_SOURCE_ALREADY_INCLUDED';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialSourceAlreadyIncludedError';
  }
}

/** 409 —— 同一个 operationId 重放时请求内容变了。 */
export class FinancialOperationMismatchError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_OPERATION_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialOperationMismatchError';
  }
}

/** 409 —— 退款分摊与实活事实冲突(超上限、跨集重复、原单已死等)。 */
export class FinancialRefundConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_REFUND_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialRefundConflictError';
  }
}

/** 409 —— 财务执行被关闭:确认/对账被拒,但读与配置仍可用。 */
export class FinancialDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_DISABLED';
  constructor(message = 'Financial planning is disabled in the saved configuration.') {
    super(message);
    this.name = 'FinancialDisabledError';
  }
}

/** 503 —— 库里存的财务事实无法解释(坏 JSON、未知版本、越界金额)。 */
export class FinancialUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'FINANCIAL_UNAVAILABLE';
  constructor() {
    super(
      'The saved financial facts cannot be read on this server right now. Please contact the administrator.',
    );
    this.name = 'FinancialUnavailableError';
  }
}
