// Stats tab (H2+H4). Mirrors Android StatsTab + web StatsView:
// window picker + months feed three server series; charts native-drawn.

import { ApiError } from '../net/ApiClient';
import { StatsRepository } from '../repo/Repositories';
import { DonutChart, MonthlyBars, PoolSparkline, ShareSlice, TrendPoint, PoolPoint } from './Charts';
import { formatMonth } from './format';
import router from '@ohos.router';

export interface ShareItemResp {
  categoryName: string;
  amountCents: number;
}

export interface ShareResp {
  items: ShareItemResp[];
  totalCents: number;
}

export interface TrendRawItem {
  incomeCents: number;
  netExpenseCents: number;
  monthStart: number;
}

export interface TrendRawResp {
  items: TrendRawItem[];
}

export interface PoolRawItem {
  poolCents: number;
  periodStart: number;
}

export interface PoolRawResp {
  points: PoolRawItem[];
}

export function statsWindow(kind: string): number[] {
  const now: Date = new Date();
  const to: number = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  if (kind === 'last30') {
    const out: number[] = [Date.now() - 30 * 86400000, to];
    return out;
  }
  if (kind === 'last3Months') {
    const from: number = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0).getTime();
    const out: number[] = [from, to];
    return out;
  }
  const from: number = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
  const out: number[] = [from, to];
  return out;
}

@Component
export struct StatsView {
  @State windowKind: string = 'thisMonth';
  @State months: number = 6;
  @State slices: ShareSlice[] = [];
  @State shareTotal: number = 0;
  @State trend: TrendPoint[] = [];
  @State pool: PoolPoint[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  private repo: StatsRepository = new StatsRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const w: number[] = statsWindow(this.windowKind);
      const shareText: string = await this.repo.categoryShare(w[0] as number, w[1] as number);
      const share: ShareResp = JSON.parse(shareText) as ShareResp;
      const trendText: string = await this.repo.monthlyTrend(this.months);
      const trendRaw: TrendRawResp = JSON.parse(trendText) as TrendRawResp;
      const poolText: string = await this.repo.poolTrend();
      const poolRaw: PoolRawResp = JSON.parse(poolText) as PoolRawResp;
      const rawSlices: ShareItemResp[] = share.items ?? [];
      const slices: ShareSlice[] = [];
      for (let i: number = 0; i < rawSlices.length; i++) {
        const s: ShareItemResp = rawSlices[i] as ShareItemResp;
        const sl: ShareSlice = { categoryName: s.categoryName, amountCents: s.amountCents };
        slices.push(sl);
      }
      this.slices = slices;
      const gotTotal: number | undefined = share.totalCents;
      if (gotTotal !== undefined) {
        this.shareTotal = gotTotal;
      } else {
        let sum: number = 0;
        for (let i: number = 0; i < slices.length; i++) {
          sum += (slices[i] as ShareSlice).amountCents;
        }
        this.shareTotal = sum;
      }
      const rawTrend: TrendRawItem[] = trendRaw.items ?? [];
      const trend: TrendPoint[] = [];
      for (let i: number = 0; i < rawTrend.length; i++) {
        const p: TrendRawItem = rawTrend[i] as TrendRawItem;
        const tp: TrendPoint = {
          incomeCents: p.incomeCents, netExpenseCents: p.netExpenseCents,
          monthStart: p.monthStart, label: formatMonth(p.monthStart)
        };
        trend.push(tp);
      }
      this.trend = trend;
      const rawPool: PoolRawItem[] = poolRaw.points ?? [];
      const pool: PoolPoint[] = [];
      for (let i: number = 0; i < rawPool.length; i++) {
        const p: PoolRawItem = rawPool[i] as PoolRawItem;
        const pp: PoolPoint = { poolCents: p.poolCents, label: formatMonth(p.periodStart) };
        pool.push(pp);
      }
      this.pool = pool;
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
      Text('统计').fontSize(22);
      Row({ space: 8 }) {
        Button(this.windowKind === 'thisMonth' ? '● 本月' : '本月', { type: ButtonType.Normal })
          .onClick(() => { this.windowKind = 'thisMonth'; this.reload(); });
        Button(this.windowKind === 'last30' ? '● 近 30 天' : '近 30 天', { type: ButtonType.Normal })
          .onClick(() => { this.windowKind = 'last30'; this.reload(); });
        Button(this.windowKind === 'last3Months' ? '● 近 3 个月' : '近 3 个月', { type: ButtonType.Normal })
          .onClick(() => { this.windowKind = 'last3Months'; this.reload(); });
      }.width('100%');
      Row({ space: 8 }) {
        ForEach([3, 6, 12], (m: number) => {
          Button(this.months === m ? `● ${m} 个月` : `${m} 个月`, { type: ButtonType.Normal })
            .onClick(() => { this.months = m; this.reload(); });
        });
      }.width('100%');
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.reload(); });
      } else {
        Scroll() {
          Column({ space: 12 }) {
            DonutChart({ slices: this.slices, totalCents: this.shareTotal });
            MonthlyBars({ points: this.trend });
            PoolSparkline({ points: this.pool });
          }.width('100%');
        }.width('100%').layoutWeight(1);
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }
}
