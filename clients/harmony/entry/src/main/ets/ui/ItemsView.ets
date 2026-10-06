// Items (H2). Mirrors Android ItemsTab + web ItemsView (core slice):
// list + status filter + summary + create/edit + sell/retire + photo note.
// Full cutout-candidate flow stays Web-first; ordinary photo path works here.

import { ApiError, ApiQuery } from '../net/ApiClient';
import { ItemRepository } from '../repo/Repositories';
import { formatYuan, formatDay } from './format';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface ItemRow {
  id: string;
  name: string;
  status: string;
  buyPriceCents: number;
  buyDate: number;
  hasPhoto: boolean;
}

export interface ItemListResp {
  items: ItemRow[];
}

export interface ItemSummaryResp {
  totalBuyCents: number;
  count: number;
}

export interface ItemCreateBody {
  name: string;
  buyPriceCents: number;
  buyDate: number;
}

export interface SellBody {
  sellPriceCents: number;
  sellDate: number;
}

export interface StatusEntry {
  status: string;
}

export interface StatusLabel {
  k: string;
  v: string;
}

const STATUS_LABELS: StatusLabel[] = [
  { k: 'all', v: '全部' },
  { k: 'active', v: '使用中' },
  { k: 'idle', v: '闲置' },
  { k: 'sold', v: '已售出' },
  { k: 'retired', v: '已退役' },
];

@Component
export struct ItemsView {
  @State items: ItemRow[] = [];
  @State summaryText: string = '';
  @State status: string = 'all';
  @State query: string = '';
  @State loading: boolean = true;
  @State error: string = '';
  @State editing: boolean = false;
  @State editId: string = '';
  @State name: string = '';
  @State priceText: string = '';

  private repo: ItemRepository = new ItemRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const q: ApiQuery = { limit: '200' };
      if (this.status !== 'all') {
        q.status = this.status;
      }
      if (this.query.trim() !== '') {
        q.q = this.query.trim();
      }
      const text: string = await this.repo.list(q);
      const raw: ItemListResp = JSON.parse(text) as ItemListResp;
      const items: ItemRow[] = raw.items ?? [];
      this.items = items;
      try {
        const sText: string = await this.repo.summary();
        const s: ItemSummaryResp = JSON.parse(sText) as ItemSummaryResp;
        const total: number | undefined = s.totalBuyCents;
        const totalCents: number = total === undefined ? 0 : total;
        const gotCount: number | undefined = s.count;
        const count: number = gotCount === undefined ? this.items.length : gotCount;
        this.summaryText = `共 ${count} 件 · 购入合计 ${formatYuan(totalCents)}`;
      } catch (e) {
        hilog.error(0x0000, 'jizhang', 'summary load failed: %{public}s', String(e));
        this.summaryText = `共 ${this.items.length} 件`;
      }
      this.error = '';
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

  async save(): Promise<void> {
    const v: number = Number(this.priceText.trim());
    if (!this.name.trim()) {
      this.error = '请填写物品名称';
      return;
    }
    if (!isFinite(v) || v <= 0) {
      this.error = '购入价须为大于 0 的数字';
      return;
    }
    try {
      const body: ItemCreateBody = { name: this.name.trim(), buyPriceCents: Math.round(v * 100), buyDate: Date.now() };
      if (!this.editId) {
        await this.repo.create(body);
      } else {
        await this.repo.update(this.editId, body);
      }
      this.editing = false;
      this.editId = '';
      this.name = '';
      this.priceText = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async sell(id: string): Promise<void> {
    try {
      const body: SellBody = { sellPriceCents: 0, sellDate: Date.now() };
      await this.repo.sell(id, body);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.repo.remove(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private statusKeys(): string[] {
    const keys: string[] = ['all', 'active', 'idle', 'sold', 'retired'];
    return keys;
  }

  private statusLabel(k: string): string {
    for (let i: number = 0; i < STATUS_LABELS.length; i++) {
      const one: StatusLabel = STATUS_LABELS[i] as StatusLabel;
      if (one.k === k) {
        return one.v;
      }
    }
    return k;
  }

  build() {
    Column({ space: 8 }) {
      Text('物品资产').fontSize(20);
      if (this.summaryText !== '') {
        Text(this.summaryText).fontSize(13).fontColor('#5f6b7a');
      }
      if (this.editing) {
        Text(!this.editId ? '新增物品' : '编辑物品').fontSize(16);
        TextInput({ placeholder: '名称', text: this.name })
          .onChange((v: string) => { this.name = v; });
        TextInput({ placeholder: '购入价（元）', text: this.priceText })
          .inputFilter('^[0-9.]*$')
          .onChange((v: string) => { this.priceText = v; });
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#c92a2a');
        }
        Row({ space: 8 }) {
          Button('保存').onClick(() => { this.save(); });
          Button('取消', { type: ButtonType.Normal }).onClick(() => {
            this.editing = false;
            this.editId = '';
            this.error = '';
          });
        }.width('100%');
      } else if (this.loading) {
        Text('加载中…');
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#c92a2a');
        }
        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.statusKeys(), (k: string) => {
              Button(this.status === k ? `● ${this.statusLabel(k)}` : this.statusLabel(k),
                { type: ButtonType.Normal })
                .onClick(() => { this.status = k; this.reload(); });
            });
          }
        }.width('100%').scrollable(ScrollDirection.Horizontal);
        Row({ space: 8 }) {
          TextInput({ placeholder: '搜索…', text: this.query })
            .layoutWeight(1)
            .onChange((v: string) => { this.query = v; })
            .onSubmit(() => { this.reload(); });
          Button('新增').onClick(() => {
            this.editing = true;
            this.editId = '';
            this.name = '';
            this.priceText = '';
          });
        }.width('100%');
        List({ space: 6 }) {
          ForEach(this.items, (it: ItemRow) => {
            ListItem() {
              Column({ space: 4 }) {
                Row() {
                  Text(it.name).fontSize(15).layoutWeight(1);
                  Text(this.statusLabel(it.status)).fontSize(12).fontColor('#5f6b7a');
                }.width('100%');
                Text(`${formatYuan(it.buyPriceCents)} · ${formatDay(it.buyDate)}${it.hasPhoto ? ' · 有图' : ''}`)
                  .fontSize(12).fontColor('#5f6b7a');
                Row({ space: 8 }) {
                  Button('编辑', { type: ButtonType.Normal }).onClick(() => {
                    this.editing = true;
                    this.editId = it.id;
                    this.name = it.name;
                    this.priceText = (it.buyPriceCents / 100).toFixed(2);
                  });
                  if (it.status === 'active' || it.status === 'idle') {
                    Button('售出', { type: ButtonType.Normal }).onClick(() => {
                      this.sell(it.id);
                    });
                  }
                  Button('删除', { type: ButtonType.Normal }).onClick(() => {
                    this.remove(it.id);
                  });
                }
                Text('照片上传请在后续版本经相册选择，普通上传通道已就绪。')
                  .fontSize(11).fontColor('#5f6b7a');
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
    }.width('100%').height('100%').padding(16);
  }
}
