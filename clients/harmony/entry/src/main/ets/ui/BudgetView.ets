// Budget tab (H2). Mirrors Android BudgetTab + web BudgetView.vue:
// all figures server-computed; period switcher only when >1 cycle;
// empty state routes to salary entry; 80%/overspend tone display-only.

import { ApiError } from '../net/ApiClient';
import { BudgetRepository, RecurringRepository } from '../repo/Repositories';
import { formatYuan, periodLabel } from './format';
import { PendingCountResp, PendingIdResp } from './api-types';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface BudgetModule {
  categoryId: string;
  categoryName: string;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
}

export interface PeriodsResp {
  periods: number[];
  currentPeriodStart: number | null;
}

export interface OverviewResp {
  hasBudget: boolean;
  carryoverPoolCents: number;
  totalBudgetCents: number;
  totalSpentCents: number;
  modules: BudgetModule[];
}

function usedPercent(spent: number, budget: number): number {
  if (budget <= 0) {
    return spent > 0 ? 100 : 0;
  }
  return Math.round(spent / budget * 100);
}

function toneSuffix(spent: number, budget: number): string {
  if (budget <= 0) {
    return spent > 0 ? '（已超支）' : '';
  }
  const pct: number = spent / budget;
  if (pct > 1) {
    return '（已超支）';
  }
  if (pct >= 0.8) {
    return '（将超支）';
  }
  return '';
}

@Component
export struct BudgetView {
  @State hasBudget: boolean = false;
  @State pool: number = 0;
  @State totalBudget: number = 0;
  @State totalSpent: number = 0;
  @State modules: BudgetModule[] = [];
  @State periods: number[] = [];
  @State currentStart: number | null = null;
  @State selected: number | null = null;
  @State pendingCount: number = 0;
  @State loading: boolean = true;
  @State error: string = '';
  onNewSalary: () => void = () => {};

  private repo: BudgetRepository = new BudgetRepository();
  private recurring: RecurringRepository = new RecurringRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const pText: string = await this.repo.periods();
      const p: PeriodsResp = JSON.parse(pText) as PeriodsResp;
      const gotPeriods: number[] = p.periods ?? [];
      this.periods = gotPeriods;
      const gotCur: number | null | undefined = p.currentPeriodStart;
      this.currentStart = gotCur === undefined ? null : gotCur;
      const sel: number | null = this.selected;
      const ovText: string = await this.repo.overview(sel === null ? undefined : (sel as number));
      const ov: OverviewResp = JSON.parse(ovText) as OverviewResp;
      const hb: boolean | undefined = ov.hasBudget;
      this.hasBudget = hb === undefined ? false : hb;
      const pool: number | undefined = ov.carryoverPoolCents;
      this.pool = pool === undefined ? 0 : pool;
      const tb: number | undefined = ov.totalBudgetCents;
      this.totalBudget = tb === undefined ? 0 : tb;
      const ts: number | undefined = ov.totalSpentCents;
      this.totalSpent = ts === undefined ? 0 : ts;
      const mods: BudgetModule[] = ov.modules ?? [];
      this.modules = mods;
      try {
        const pendText: string = await this.recurring.pending();
        const pend: PendingCountResp = JSON.parse(pendText) as PendingCountResp;
        const pendTotal: number | undefined = pend.total;
        if (pendTotal !== undefined) {
          this.pendingCount = pendTotal;
        } else {
          const pendItems: PendingIdResp[] = pend.items ?? [];
          this.pendingCount = pendItems.length;
        }
      } catch (e) {
        hilog.error(0x0000, 'jizhang', 'pending count failed: %{public}s', String(e));
        this.pendingCount = 0;
      }
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        router.replaceUrl({ url: 'pages/Login' });
        return;
      }
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('预算').fontSize(22);
      if (this.loading && this.modules.length === 0 && !this.hasBudget) {
        Text('加载中…');
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => {
          this.reload();
        });
      } else {
        if (this.pendingCount > 0) {
          Text(`${this.pendingCount} 笔周期账单待确认`).fontColor('#2f6f8f').fontSize(13);
        }
        if (this.periods.length > 1) {
          Scroll() {
            Row({ space: 8 }) {
              Button(this.selected === null ? '● 当前周期' : '当前周期', { type: ButtonType.Normal })
                .onClick(() => {
                  this.selected = null;
                  this.reload();
                });
              ForEach(this.periods.slice(0, 6), (ps: number) => {
                Button(this.selected === ps ? `● ${periodLabel(ps)}` : periodLabel(ps), { type: ButtonType.Normal })
                  .onClick(() => {
                    this.selected = ps;
                    this.reload();
                  });
              });
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal);
        }
        if (this.selected !== null) {
          Text(`正在查看历史周期 ${periodLabel(this.selected as number)}，数据不会随新账单变化。`)
            .fontSize(12).fontColor('#2f6f8f');
        }
        if (!this.hasBudget) {
          Text('还没有预算周期');
          Text('记一次工资，系统会按模板比例自动分配各模块预算。').fontSize(13).fontColor('#5f6b7a');
          Button('记工资', { type: ButtonType.Capsule }).width('100%').onClick(() => {
            this.onNewSalary();
          });
        } else {
          Text(`结余池：${formatYuan(this.pool)}`).fontSize(17);
          Text(`总预算 ${formatYuan(this.totalBudget)} · 已用 ${formatYuan(this.totalSpent)}`)
            .fontSize(12).fontColor('#5f6b7a');
          List({ space: 6 }) {
            ForEach(this.modules, (m: BudgetModule) => {
              ListItem() {
                Column({ space: 4 }) {
                  Row() {
                    Text(m.categoryName).fontSize(15).layoutWeight(1);
                    Text(`${formatYuan(m.spentCents)} / ${formatYuan(m.budgetCents)}`).fontSize(13);
                  }.width('100%');
                  Progress({
                    value: m.budgetCents <= 0 ? (m.spentCents > 0 ? 100 : 0) :
                      Math.min(100, Math.round(m.spentCents / m.budgetCents * 100)),
                    total: 100,
                    type: ProgressType.Linear
                  }).width('100%');
                  Text(`剩余 ${formatYuan(m.remainingCents)} · ${usedPercent(m.spentCents, m.budgetCents)}%${toneSuffix(m.spentCents, m.budgetCents)}`)
                    .fontSize(12).fontColor('#5f6b7a');
                }
                .width('100%')
                .padding(12)
                .backgroundColor('#ffffff')
                .border({ width: 1, color: '#e3e6ea' })
                .borderRadius(12);
              }
            });
          }.width('100%').layoutWeight(1);
        }
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }
}
