// Native charts (H4). Hand-drawn Canvas, no WebView (design §4 trade-off).
// Mirrors Android Charts.kt + web hand-rolled SVG: donut (positive wedges
// only), dual income/expense bars, pool sparkline. Inputs are server figures.
//
// Canvas API (SDK 26): `Canvas(ctx)` takes a stored CanvasRenderingContext2D;
// draw with ctx methods inside onReady. Context must live as a
// member — never created inline in build().

import { CHART_PALETTE } from './theme';

export interface ShareSlice {
  categoryName: string;
  amountCents: number;
}

export interface TrendPoint {
  incomeCents: number;
  netExpenseCents: number;
  monthStart: number;
  label: string;
}

export interface PoolPoint {
  poolCents: number;
  label: string;
}

export interface ChartSeg {
  start: number;
  sweep: number;
  color: string;
}

export interface ChartRow {
  key: string;
  name: string;
  text: string;
  color: string;
}

export interface ChartKey {
  key: string;
}

function yuanText(cents: number): string {
  const sign: string = cents < 0 ? '-' : '';
  const abs: number = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${abs % 100 < 10 ? '0' : ''}${abs % 100}`;
}

@Component
export struct DonutChart {
  @State slices: ShareSlice[] = [];
  @State totalCents: number = 0;
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D();

  private segs(): ChartSeg[] {
    const positive: ShareSlice[] = this.slices.filter((s: ShareSlice): boolean => s.amountCents > 0);
    let total: number = 0;
    for (let i: number = 0; i < positive.length; i++) {
      total += (positive[i] as ShareSlice).amountCents;
    }
    if (total <= 0) {
      const empty: ChartSeg[] = [];
      return empty;
    }
    let start: number = -90;
    const out: ChartSeg[] = [];
    for (let i: number = 0; i < positive.length; i++) {
      const s: ShareSlice = positive[i] as ShareSlice;
      const sweep: number = (s.amountCents / total) * 360;
      const seg: ChartSeg = { start: start, sweep: sweep, color: CHART_PALETTE[i % CHART_PALETTE.length] as string };
      out.push(seg);
      start += sweep;
    }
    return out;
  }

  private rows(): ChartRow[] {
    const positive: ShareSlice[] = this.slices.filter((s: ShareSlice): boolean => s.amountCents > 0);
    let total: number = 0;
    for (let i: number = 0; i < positive.length; i++) {
      total += (positive[i] as ShareSlice).amountCents;
    }
    const out: ChartRow[] = [];
    for (let i: number = 0; i < positive.length; i++) {
      const s: ShareSlice = positive[i] as ShareSlice;
      const pct: number = total <= 0 ? 0 : Math.round((s.amountCents / total) * 100);
      const row: ChartRow = {
        key: `${s.categoryName}-${i}`,
        name: s.categoryName,
        text: `${yuanText(s.amountCents)} ${pct}%`,
        color: CHART_PALETTE[i % CHART_PALETTE.length] as string,
      };
      out.push(row);
    }
    return out;
  }

  private draw(): void {
    const ctx: CanvasRenderingContext2D = this.ctx;
    const w: number = ctx.width;
    const h: number = ctx.height;
    if (w <= 0 || h <= 0) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const r: number = Math.min(w, h) * 0.32;
    const cx: number = w / 2;
    const cy: number = h / 2;
    ctx.lineWidth = r * 0.55;
    const segs: ChartSeg[] = this.segs();
    for (let i: number = 0; i < segs.length; i++) {
      const seg: ChartSeg = segs[i] as ChartSeg;
      ctx.beginPath();
      ctx.strokeStyle = seg.color;
      ctx.arc(cx, cy, r, (seg.start * Math.PI) / 180, ((seg.start + seg.sweep) * Math.PI) / 180);
      ctx.stroke();
    }
  }

  build() {
    Column({ space: 6 }) {
      Text(`分类占比 · 共 ${yuanText(this.totalCents)}`).fontSize(14);
      if (this.segs().length === 0) {
        Text('暂无数据').fontSize(12).fontColor('#5f6b7a');
      } else {
        Canvas(this.ctx)
          .width('100%')
          .height(200)
          .onReady(() => {
            this.draw();
          });
        ForEach(this.rows(), (row: ChartRow) => {
          Text(`● ${row.name} ${row.text}`).fontSize(12).fontColor(row.color);
        }, (row: ChartRow) => (row as ChartKey).key);
      }
    }.width('100%');
  }
}

@Component
export struct MonthlyBars {
  @State points: TrendPoint[] = [];
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D();

  private draw(): void {
    const ctx: CanvasRenderingContext2D = this.ctx;
    const w: number = ctx.width;
    const h: number = ctx.height;
    if (w <= 0 || h <= 0 || this.points.length === 0) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    let maxV: number = 1;
    for (let i: number = 0; i < this.points.length; i++) {
      const p: TrendPoint = this.points[i] as TrendPoint;
      if (p.incomeCents > maxV) {
        maxV = p.incomeCents;
      }
      if (p.netExpenseCents > maxV) {
        maxV = p.netExpenseCents;
      }
    }
    const n: number = this.points.length;
    const groupW: number = w / n;
    const barW: number = groupW * 0.28;
    for (let i: number = 0; i < this.points.length; i++) {
      const p: TrendPoint = this.points[i] as TrendPoint;
      const ih: number = (p.incomeCents / maxV) * h * 0.9;
      const eh: number = (p.netExpenseCents / maxV) * h * 0.9;
      const cx: number = i * groupW + groupW / 2;
      ctx.fillStyle = '#2d6a4f';
      ctx.fillRect(cx - barW - 2, h - ih, barW, ih);
      ctx.fillStyle = '#c92a2a';
      ctx.fillRect(cx + 2, h - eh, barW, eh);
    }
  }

  build() {
    Column({ space: 6 }) {
      Text('月度收入与净支出').fontSize(14);
      if (this.points.length === 0) {
        Text('暂无数据').fontSize(12).fontColor('#5f6b7a');
      } else {
        Canvas(this.ctx)
          .width('100%')
          .height(180)
          .onReady(() => {
            this.draw();
          });
        Text(this.trendLabels()).fontSize(12).fontColor('#5f6b7a');
      }
    }.width('100%');
  }

  private trendLabels(): string {
    let out: string = '';
    for (let i: number = 0; i < this.points.length; i++) {
      if (i > 0) {
        out += ' · ';
      }
      out += (this.points[i] as TrendPoint).label;
    }
    return out;
  }
}

@Component
export struct PoolSparkline {
  @State points: PoolPoint[] = [];
  @State accent: string = '#2f6f8f';
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D();

  private draw(): void {
    const ctx: CanvasRenderingContext2D = this.ctx;
    const w: number = ctx.width;
    const h: number = ctx.height;
    if (w <= 0 || h <= 0 || this.points.length < 2) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    const values: number[] = [];
    for (let i: number = 0; i < this.points.length; i++) {
      values.push((this.points[i] as PoolPoint).poolCents);
    }
    let min: number = 0;
    let max: number = 0;
    for (let i: number = 0; i < values.length; i++) {
      const v: number = values[i] as number;
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
    if (min === max) {
      max = min + 1;
    }
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i: number = 0; i < values.length; i++) {
      const v: number = values[i] as number;
      const x: number = (i / (values.length - 1)) * w;
      const y: number = h - ((v - min) / (max - min)) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  build() {
    Column({ space: 6 }) {
      Text('结余池趋势').fontSize(14);
      if (this.points.length < 2) {
        Text('数据不足，需至少两个周期').fontSize(12).fontColor('#5f6b7a');
      } else {
        Canvas(this.ctx)
          .width('100%')
          .height(80)
          .onReady(() => {
            this.draw();
          });
        Text(`最新 ${yuanText((this.points[this.points.length - 1] as PoolPoint).poolCents)}`)
          .fontSize(12)
          .fontColor('#5f6b7a');
      }
    }.width('100%');
  }
}
