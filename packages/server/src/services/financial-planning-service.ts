/**
 * 财务执行(Phase 1)服务外观:统一协调配置、工资周期与退款净执行读模型。
 *
 * 职责分工(按 Task 5 模块拆分):
 * - `financial-planning-types.ts`: 所有 DTO、元信息、分页与集合上限定义;
 * - `financial-planning-config.ts`: 配置读取/保存、类别映射快照、拓扑检查与时区;
 * - `financial-planning-periods.ts`: 工资来源、周期预览/确认/对账、修订历史;
 * - `financial-planning-refunds.ts`: 退款复核、分摊计算、净执行事实与账单用途。
 *
 * 本外观保留既有所有公开方法签名,作为调用方的兼容层。
 */
import type {
  FinancialCycle,
  FinancialMappingSnapshot,
  PeriodRow,
} from './financial-planning-types.js';
import type { Db } from '../db/index.js';
import {
  getFinancialOperation,
  type FinancialOperationRecord,
} from './financial-operation-store.js';
import {
  type FinancialConfig,
  type FinancialExecution,
  type FinancialExecutionFactDto,
  type FinancialMeta,
  type FinancialPeriod,
  type FinancialPlanningOptions,
  type FinancialPreview,
  type FinancialRefundReview,
  type FinancialSalarySource,
} from './financial-planning-types.js';
import { FinancialPlanningConfigService } from './financial-planning-config.js';
import { FinancialPlanningPeriodsService } from './financial-planning-periods.js';
import { FinancialPlanningRefundsService } from './financial-planning-refunds.js';

export * from './financial-planning-types.js';
export { FinancialPlanningConfigService } from './financial-planning-config.js';
export { FinancialPlanningPeriodsService } from './financial-planning-periods.js';
export { FinancialPlanningRefundsService } from './financial-planning-refunds.js';

export class FinancialPlanningService {
  private readonly db: Db;
  readonly configService: FinancialPlanningConfigService;
  readonly periodsService: FinancialPlanningPeriodsService;
  readonly refundsService: FinancialPlanningRefundsService;

  constructor(db: Db, options: FinancialPlanningOptions = {}) {
    this.db = db;
    this.configService = new FinancialPlanningConfigService(db, options);
    this.periodsService = new FinancialPlanningPeriodsService(db, this.configService, options);
    this.refundsService = new FinancialPlanningRefundsService(
      db,
      this.configService,
      this.periodsService,
      options,
    );
  }

  serverTimeZone(): string {
    return this.configService.serverTimeZone();
  }

  legacyCycle(): FinancialCycle {
    return this.configService.legacyCycle();
  }

  resolveActorId(): string {
    return this.configService.resolveActorId();
  }

  capabilities(): FinancialMeta & Record<string, unknown> {
    return this.configService.capabilities();
  }

  readConfig(): FinancialConfig {
    return this.configService.readConfig();
  }

  getConfig(): FinancialMeta & {
    config: FinancialConfig;
    mappingRevision: number;
    legacyCycle: FinancialCycle;
  } {
    return this.configService.getConfig();
  }

  putConfig(rawBody: unknown): FinancialMeta & { config: FinancialConfig } {
    return this.configService.putConfig(rawBody);
  }

  readMapping(): FinancialMappingSnapshot {
    return this.configService.readMapping();
  }

  getMapping(): FinancialMeta & { mapping: FinancialMappingSnapshot } {
    return this.configService.getMapping();
  }

  putMapping(rawBody: unknown): FinancialMeta & { mapping: FinancialMappingSnapshot } {
    return this.configService.putMapping(rawBody);
  }

  listSalarySources(
    query: Record<string, unknown>,
  ): FinancialMeta & {
    items: FinancialSalarySource[];
    total: number;
    limit: number;
    offset: number;
  } {
    return this.periodsService.listSalarySources(query);
  }

  getSalarySource(salaryId: string): FinancialMeta & { source: FinancialSalarySource } {
    return this.periodsService.getSalarySource(salaryId);
  }

  previewPeriod(rawBody: unknown): FinancialMeta & { preview: FinancialPreview } {
    return this.periodsService.previewPeriod(rawBody);
  }

  confirmPeriod(
    rawBody: unknown,
  ): FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] } {
    return this.periodsService.confirmPeriod(rawBody);
  }

  reconcilePeriod(
    periodId: string,
    rawBody: unknown,
  ): FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] } {
    return this.periodsService.reconcilePeriod(periodId, rawBody);
  }

  listPeriods(
    query: Record<string, unknown>,
  ): FinancialMeta & {
    items: FinancialPeriod[];
    total: number;
    limit: number;
    offset: number;
    currentPeriodId: string | null;
  } {
    return this.periodsService.listPeriods(query);
  }

  currentPeriod(): PeriodRow | null {
    return this.periodsService.currentPeriod();
  }

  getPeriod(
    periodId: string,
    revision?: number | undefined,
  ): FinancialMeta & { period: FinancialPeriod } {
    return this.periodsService.getPeriod(periodId, revision);
  }

  listPeriodRevisions(
    periodId: string,
    query: Record<string, unknown>,
  ): FinancialMeta & { items: FinancialPeriod[]; total: number; limit: number; offset: number } {
    return this.periodsService.listPeriodRevisions(periodId, query);
  }

  getExecution(
    periodId?: string | undefined,
  ): FinancialMeta & { state: 'ready' | 'no-period'; execution: FinancialExecution | null } {
    return this.refundsService.getExecution(periodId);
  }

  listExecutionFacts(
    periodId: string,
    query: Record<string, unknown>,
  ): FinancialMeta & {
    periodId: string;
    revision: number;
    items: FinancialExecutionFactDto[];
    total: number;
    limit: number;
    offset: number;
  } {
    return this.refundsService.listExecutionFacts(periodId, query);
  }

  billPurposeView(
    transactionId: string,
  ): ReturnType<FinancialPlanningRefundsService['billPurposeView']> {
    return this.refundsService.billPurposeView(transactionId);
  }

  getBillPurpose(
    transactionId: string,
  ): FinancialMeta & { billPurpose: ReturnType<FinancialPlanningRefundsService['billPurposeView']> } {
    return this.refundsService.getBillPurpose(transactionId);
  }

  putBillPurpose(
    transactionId: string,
    rawBody: unknown,
  ): FinancialMeta & {
    billPurpose: ReturnType<FinancialPlanningRefundsService['billPurposeView']>;
    affectedPeriodIds: string[];
  } {
    return this.refundsService.putBillPurpose(transactionId, rawBody);
  }

  listRefunds(
    query: Record<string, unknown>,
  ): FinancialMeta & { items: FinancialRefundReview[]; total: number; limit: number; offset: number } {
    return this.refundsService.listRefunds(query);
  }

  getRefund(refundId: string): FinancialMeta & { refund: FinancialRefundReview } {
    return this.refundsService.getRefund(refundId);
  }

  putRefundSplits(
    refundId: string,
    rawBody: unknown,
  ): FinancialMeta & { refund: FinancialRefundReview; affectedPeriodIds: string[] } {
    return this.refundsService.putRefundSplits(refundId, rawBody);
  }

  operation(
    operationId: string,
  ): (FinancialMeta & FinancialOperationRecord & { operation: FinancialOperationRecord }) | undefined {
    const record = getFinancialOperation(this.db, operationId, this.resolveActorId());
    if (record === undefined) return undefined;
    return {
      ...this.configService.meta(),
      ...record,
      operation: record,
    };
  }
}
