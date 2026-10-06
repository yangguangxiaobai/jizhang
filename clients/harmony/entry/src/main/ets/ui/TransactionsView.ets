// Transactions month view (H2). Mirrors Android TransactionsTab + web
// TransactionsView: month pager, type filter, account note, delete→trash.

import { ApiError, ApiQuery } from '../net/ApiClient';
import { LedgerRepository, MetaRepository } from '../repo/Repositories';
import { formatYuan, formatDay } from './format';
import { CatListResp, AccountListResp, CatNameItem, AccountNameItem } from './api-types';
import router from '@ohos.router';

export interface NameEntry {
  id: string;
  name: string;
}

export interface TxItem {
  id: string;
  type: number;
  amountCents: number;
  date: number;
  note: string;
  categoryId: string;
  accountId: string;
  isRefund: boolean;
}

export interface TxListResp {
  items: TxItem[];
  total: number;
}

export function monthRange(offset: number): number[] {
  const now: Date = new Date();
  const from: number = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0).getTime();
  const to: number = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1, 0, 0, 0, 0).getTime();
  const out: number[] = [from, to];
  return out;
}

function monthLabel(offset: number): string {
  const now: Date = new Date();
  const d: Date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

@Component
export struct TransactionsView {
  @State items: TxItem[] = [];
  @State total: number = 0;
  @State loading: boolean = true;
  @State error: string = '';
  @State monthOffset: number = 0;
  @State typeFilter: number | null = null;
  @State catNames: NameEntry[] = [];
  @State accountNames: NameEntry[] = [];
  @State confirmId: string = '';
  @State confirmLabel: string = '';
  onNew: () => void = () => {};
  onEdit: (id: string) => void = () => {};

  private ledger: LedgerRepository = new LedgerRepository();
  private meta: MetaRepository = new MetaRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const range: number[] = monthRange(this.monthOffset);
      const q: ApiQuery = {
        from: String(range[0] as number), to: String(range[1] as number), limit: '500'
      };
      if (this.typeFilter !== null) {
        q.type = String(this.typeFilter as number);
      }
      const resText: string = await this.ledger.listTransactions(q);
      const res: TxListResp = JSON.parse(resText) as TxListResp;
      const got: TxItem[] = res.items ?? [];
      this.items = got;
      const gotTotal: number | undefined = res.total;
      this.total = gotTotal === undefined ? got.length : gotTotal;
      const catsText: string = await this.meta.categories();
      const cats: CatListResp = JSON.parse(catsText) as CatListResp;
      const cn: NameEntry[] = [];
      const catItems: CatNameItem[] = cats.items ?? [];
      for (let i: number = 0; i < catItems.length; i++) {
        const c: CatNameItem = catItems[i] as CatNameItem;
        const one: NameEntry = { id: c.id, name: c.name };
        cn.push(one);
      }
      this.catNames = cn;
      const accsText: string = await this.meta.accounts();
      const accs: AccountListResp = JSON.parse(accsText) as AccountListResp;
      const an: NameEntry[] = [];
      const accItems: AccountNameItem[] = accs.items ?? [];
      for (let i: number = 0; i < accItems.length; i++) {
        const a: AccountNameItem = accItems[i] as AccountNameItem;
        const one: NameEntry = { id: a.id, name: a.name };
        an.push(one);
      }
      this.accountNames = an;
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
      const one: NameEntry = this.catNames[i] as NameEntry;
      if (one.id === id) {
        return one.name;
      }
    }
    return '';
  }

  private accountNameOf(id: string): string {
    for (let i: number = 0; i < this.accountNames.length; i++) {
      const one: NameEntry = this.accountNames[i] as NameEntry;
      if (one.id === id) {
        return one.name;
      }
    }
    return '';
  }

  async doDelete(): Promise<void> {
    const id: string = this.confirmId;
    this.confirmId = '';
    if (!id) {
      return;
    }
    try {
      await this.ledger.removeTransaction(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Button('‹').onClick(() => {
          this.monthOffset--;
          this.reload();
        });
        Text(monthLabel(this.monthOffset)).fontSize(17).layoutWeight(1);
        Button('›').onClick(() => {
          this.monthOffset++;
          this.reload();
        });
      }.width('100%');

      Row({ space: 8 }) {
        Button('全部', { type: ButtonType.Normal }).onClick(() => {
          this.typeFilter = null;
          this.reload();
        });
        Button('支出', { type: ButtonType.Normal }).onClick(() => {
          this.typeFilter = 0;
          this.reload();
        });
        Button('收入', { type: ButtonType.Normal }).onClick(() => {
          this.typeFilter = 1;
          this.reload();
        });
      }.width('100%');

      Button('记一笔', { type: ButtonType.Capsule }).width('100%').onClick(() => {
        this.onNew();
      });

      Text(`共 ${this.total} 笔`).fontSize(12).fontColor('#5f6b7a');

      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => {
          this.reload();
        });
      } else {
        List({ space: 4 }) {
          ForEach(this.items, (tx: TxItem) => {
            ListItem() {
              Column({ space: 4 }) {
                Row() {
                  Text(tx.note !== '' ? tx.note : '(无备注)').fontSize(15).layoutWeight(1);
                  Text(`${(tx.type === 1 || tx.isRefund) ? '+' : '-'}${formatYuan(tx.amountCents)}`)
                    .fontSize(15)
                    .fontColor((tx.type === 1 || tx.isRefund) ? '#2f6f8f' : '#c92a2a');
                }.width('100%');
                Text(`${this.catNameOf(tx.categoryId)} · ${this.accountNameOf(tx.accountId)} · ${formatDay(tx.date)}`)
                  .fontSize(12)
                  .fontColor('#5f6b7a');
                Row({ space: 8 }) {
                  Button('编辑', { type: ButtonType.Normal }).onClick(() => {
                    this.onEdit(tx.id);
                  });
                  Button('删除', { type: ButtonType.Normal }).onClick(() => {
                    this.confirmId = tx.id;
                    this.confirmLabel = tx.note !== '' ? tx.note : '这笔账单';
                  });
                }
              }
              .width('100%')
              .padding(10)
              .backgroundColor('#ffffff')
              .border({ width: 1, color: '#e3e6ea' })
              .borderRadius(12);
            }
          });
        }.width('100%').layoutWeight(1);
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }
}
