// Dashboard section (H2). Mirrors Android DashboardTab + web DashboardView.vue:
// asset card (STOCK balances) separate from month summary (FLOW from
// monthlyTrend(1) last point); budget figures server-rendered; recent 5 rows;
// recurring reminder via explicit generate() then pending() (failures swallowed).

import { ApiError, ApiQuery } from '../net/ApiClient';
import { LedgerRepository, MetaRepository, BudgetRepository, RecurringRepository, StatsRepository } from '../repo/Repositories';
import { formatYuan, formatDay, formatMonth } from './format';
import {
  CatListResp, BalanceListResp, PendingCountResp, CatNameItem, PendingIdResp
} from './api-types';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface CatEntry {
  id: string;
  name: string;
}

export interface TxRow {
  id: string;
  type: number;
  amountCents: number;
  date: number;
  note: string;
  categoryId: string;
  isRefund: boolean;
}

export interface TxListResp {
  items: TxRow[];
  total: number;
}

export interface TrendPointResp {
  monthStart: number;
  incomeCents: number;
  netExpenseCents: number;
}

export interface TrendResp {
  items: TrendPointResp[];
}

export interface BudgetModuleResp {
  budgetCents: number;
  spentCents: number;
}

export interface BudgetOverviewResp {
  hasBudget: boolean;
  totalBudgetCents: number;
  totalSpentCents: number;
  carryoverPoolCents: number;
  modules: BudgetModuleResp[];
}

@Component
export struct DashboardView {
  @State loading: boolean = true;
  @State error: string = '';
  @State totalBalance: number | null = null;
  @State monthLabel: string = '本月概览';
  @State income: number = 0;
  @State netExpense: number = 0;
  @State budgetRemain: number | null = null;
  @State budgetPct: number | null = null;
  @State budgetAlert: string = '';
  @State budgetDanger: boolean = false;
  @State recents: TxRow[] = [];
  @State catNames: CatEntry[] = [];
  @State pendingCount: number = 0;
  onSeeAll: () => void = () => {};
  onNewTx: () => void = () => {};
  onPending: () => void = () => {};

  private stats: StatsRepository = new StatsRepository();
  private ledger: LedgerRepository = new LedgerRepository();
  private budget: BudgetRepository = new BudgetRepository();
  private meta: MetaRepository = new MetaRepository();
  private recurring: RecurringRepository = new RecurringRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const trendText: string = await this.stats.monthlyTrend(1);
      const listQ: ApiQuery = { limit: '5' };
      const listText: string = await this.ledger.listTransactions(listQ);
      const ovText: string = await this.budget.overview();
      const catsText: string = await this.meta.categories();
      let balsText: string | null = null;
      try {
        balsText = await this.meta.balances();
      } catch (e) {
        hilog.error(0x0000, 'jizhang', 'balances load failed: %{public}s', String(e));
        balsText = null;
      }
      const trend: TrendResp = JSON.parse(trendText) as TrendResp;
      const items: TrendPointResp[] = trend.items ?? [];
      if (items.length > 0) {
        const cur: TrendPointResp = items[items.length - 1] as TrendPointResp;
        this.monthLabel = formatMonth(cur.monthStart) + '概览';
        this.income = cur.incomeCents ?? 0;
        this.netExpense = cur.netExpenseCents ?? 0;
      }
      const list: TxListResp = JSON.parse(listText) as TxListResp;
      const recents: TxRow[] = list.items ?? [];
      this.recents = recents;
      const cats: CatListResp = JSON.parse(catsText) as CatListResp;
      const cn: CatEntry[] = [];
      const catItems: CatNameItem[] = cats.items ?? [];
      for (let i: number = 0; i < catItems.length; i++) {
        const c: CatNameItem = catItems[i] as CatNameItem;
        const one: CatEntry = { id: c.id, name: c.name };
        cn.push(one);
      }
      this.catNames = cn;
      if (balsText) {
        const bals: BalanceListResp = JSON.parse(balsText) as BalanceListResp;
        const tb: number | undefined = bals.totalBalanceCents;
        this.totalBalance = tb === undefined ? null : tb;
      }
      const ov: BudgetOverviewResp = JSON.parse(ovText) as BudgetOverviewResp;
      if (ov.hasBudget) {
        const tb: number = ov.totalBudgetCents ?? 0;
        const ts: number = ov.totalSpentCents ?? 0;
        this.budgetRemain = tb - ts;
        this.budgetPct = tb <= 0 ? 0 : Math.round(ts / tb * 100);
        let over: number = 0;
        let near: number = 0;
        const mods: BudgetModuleResp[] = ov.modules ?? [];
        for (let i: number = 0; i < mods.length; i++) {
          const m: BudgetModuleResp = mods[i] as BudgetModuleResp;
          const b: number = m.budgetCents ?? 0;
          const s: number = m.spentCents ?? 0;
          if (b > 0) {
            const p: number = s / b;
            if (p > 1) {
              over++;
            } else if (p >= 0.8) {
              near++;
            }
          } else if (s > 0) {
            over++;
          }
        }
        const poolNeg: boolean = (ov.carryoverPoolCents ?? 0) < 0;
        this.budgetDanger = over > 0 || poolNeg;
        if (over > 0 && poolNeg) {
          this.budgetAlert = `有 ${over} 个模块超支，已从结余池借用`;
        } else if (over > 0) {
          this.budgetAlert = `有 ${over} 个模块超支`;
        } else if (poolNeg) {
          this.budgetAlert = '结余池已被透支，本周期支出超过了预算';
        } else if (near > 0) {
          this.budgetAlert = `有 ${near} 个模块接近上限`;
        } else {
          this.budgetAlert = '';
        }
      }
      try {
        await this.recurring.generate();
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

  private catNameOf(id: string): string {
    for (let i: number = 0; i < this.catNames.length; i++) {
      const one: CatEntry = this.catNames[i] as CatEntry;
      if (one.id === id) {
        return one.name;
      }
    }
    return '';
  }

  build() {
    Column() {
      if (this.loading) {
        Text('加载中…').margin({ top: 32 });
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').margin({ top: 8 }).onClick(() => {
          this.reload();
        });
      } else {
        Scroll() {
          Column({ space: 12 }) {
            if (this.totalBalance !== null) {
              Column() {
                Text('总余额 · 所有账户').fontColor('#8fa8b5').fontSize(13);
                Text(formatYuan(this.totalBalance as number))
                  .fontSize(30)
                  .fontColor((this.totalBalance as number) < 0 ? '#ff9d9d' : '#ffffff');
              }
              .width('100%')
              .padding(20)
              .backgroundColor('#244d60')
              .borderRadius(18);
            }
            if (this.pendingCount > 0) {
              Text(`${this.pendingCount} 笔周期账单待确认 →`)
                .fontColor('#2f6f8f')
                .width('100%')
                .padding(14)
                .backgroundColor('#eef4f7')
                .borderRadius(14)
                .onClick(() => {
                  this.onPending();
                });
            }
            Column({ space: 6 }) {
              Text(this.monthLabel).fontSize(17);
              Row() {
                Column() {
                  Text('收入').fontSize(12).fontColor('#5f6b7a');
                  Text(formatYuan(this.income)).fontSize(16);
                }.layoutWeight(1);
                Column() {
                  Text('净支出').fontSize(12).fontColor('#5f6b7a');
                  Text(formatYuan(this.netExpense)).fontSize(16);
                }.layoutWeight(1);
                Column() {
                  Text('结余').fontSize(12).fontColor('#5f6b7a');
                  Text(formatYuan(this.income - this.netExpense)).fontSize(16);
                }.layoutWeight(1);
              }.width('100%');
              if (this.budgetRemain !== null) {
                Text(`预算剩余 ${formatYuan(this.budgetRemain as number)} · 已用 ${this.budgetPct ?? 0}%`)
                  .fontSize(13);
                if (this.budgetAlert !== '') {
                  Text(this.budgetAlert)
                    .fontSize(13)
                    .fontColor(this.budgetDanger ? '#c92a2a' : '#2f6f8f');
                }
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#ffffff')
            .border({ width: 1, color: '#e3e6ea' })
            .borderRadius(18);

            Row() {
              Text('最近账单').fontSize(17).layoutWeight(1);
              Button('查看全部', { type: ButtonType.Normal }).onClick(() => {
                this.onSeeAll();
              });
            }.width('100%');

            ForEach(this.recents, (tx: TxRow) => {
              ListItem() {
                Row() {
                  Column() {
                    Text(tx.note !== '' ? tx.note : this.catNameOf(tx.categoryId))
                      .fontSize(15);
                    Text(`${formatDay(tx.date)} · ${this.catNameOf(tx.categoryId)}`)
                      .fontSize(12)
                      .fontColor('#5f6b7a');
                  }.layoutWeight(1);
                  Text(`${tx.type === 1 ? '+' : '-'}${formatYuan(tx.amountCents)}`)
                    .fontSize(15);
                }.width('100%').padding({ top: 6, bottom: 6 });
              }
            });

            Button('记一笔', { type: ButtonType.Capsule })
              .width('100%')
              .margin({ top: 8 })
              .onClick(() => {
                this.onNewTx();
              });
          }
          .width('100%')
          .padding(16);
        }.width('100%').layoutWeight(1);
      }
    }.width('100%').height('100%');
  }
}
