// Transfers + trash (H2). Mirrors Android TransfersTrashTabs:
// transfers are neither income nor expense; trash is transactions-only.

import { ApiError, ApiQuery } from '../net/ApiClient';
import { LedgerRepository, MetaRepository } from '../repo/Repositories';
import { formatYuan, formatDay } from './format';
import { AccountListResp, SelOpt } from './api-types';
import router from '@ohos.router';

export interface AccEntry {
  id: string;
  name: string;
}

export interface TransferItem {
  id: string;
  amountCents: number;
  date: number;
  note: string;
  fromAccountId: string;
  toAccountId: string;
}

export interface TransferListResp {
  items: TransferItem[];
}

export interface AccountRespItem {
  id: string;
  name: string;
}

export interface TransferCreateBody {
  amountCents: number;
  fromAccountId: string;
  toAccountId: string;
  date: number;
  note: string;
}

export interface TrashItem {
  id: string;
  type: number;
  amountCents: number;
  date: number;
  note: string;
}

export interface TrashListResp {
  items: TrashItem[];
}

@Component
export struct TransfersView {
  @State items: TransferItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';
  @State amountText: string = '';
  @State fromId: string = '';
  @State toId: string = '';
  @State dateText: string = '';
  @State note: string = '';
  @State accNames: AccEntry[] = [];
  @State accIds: string[] = [];

  private ledger: LedgerRepository = new LedgerRepository();

  aboutToAppear(): void {
    const d: Date = new Date();
    const m: string = `${d.getMonth() + 1}`.padStart(2, '0');
    const day: string = `${d.getDate()}`.padStart(2, '0');
    this.dateText = `${d.getFullYear()}-${m}-${day}`;
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const q: ApiQuery = { limit: '200' };
      const text: string = await this.ledger.listTransfers(q);
      const raw: TransferListResp = JSON.parse(text) as TransferListResp;
      const items: TransferItem[] = raw.items ?? [];
      this.items = items;
      const accsText: string = await new MetaRepository().accounts();
      const accs: AccountListResp = JSON.parse(accsText) as AccountListResp;
      const nm: AccEntry[] = [];
      const ids: string[] = [];
      const accItems: AccountRespItem[] = accs.items ?? [];
      for (let i: number = 0; i < accItems.length; i++) {
        const a: AccountRespItem = accItems[i] as AccountRespItem;
        const one: AccEntry = { id: a.id, name: a.name };
        nm.push(one);
        ids.push(a.id);
      }
      this.accNames = nm;
      this.accIds = ids;
      if (!this.fromId && ids.length > 0) {
        this.fromId = ids[0] as string;
      }
      if (!this.toId && ids.length > 1) {
        this.toId = ids[1] as string;
      }
      void 0;
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

  async create(): Promise<void> {
    const v: number = Number(this.amountText.trim());
    if (!isFinite(v) || v <= 0) {
      this.error = '金额须为大于 0 的数字';
      return;
    }
    if (!this.fromId || !this.toId || this.fromId === this.toId) {
      this.error = '请选择两个不同的账户';
      return;
    }
    try {
      const t: number = Date.parse(this.dateText.trim());
      const body: TransferCreateBody = {
        amountCents: Math.round(v * 100),
        fromAccountId: this.fromId,
        toAccountId: this.toId,
        date: isNaN(t) ? Date.now() : t,
        note: this.note,
      };
      await this.ledger.createTransfer(body);
      this.amountText = '';
      this.note = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.ledger.removeTransfer(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private accNameOrEmpty(id: string): string {
    for (let i: number = 0; i < this.accNames.length; i++) {
      const one: AccEntry = this.accNames[i] as AccEntry;
      if (one.id === id) {
        return one.name;
      }
    }
    return '';
  }

  private accNameOrDefault(id: string, fallback: string): string {
    const got: string = this.accNameOf(id);
    if (got === id) {
      return fallback;
    }
    return got;
  }

  private accNameOf(id: string): string {
    for (let i: number = 0; i < this.accNames.length; i++) {
      const one: AccEntry = this.accNames[i] as AccEntry;
      if (one.id === id) {
        return one.name;
      }
    }
    return id;
  }

  private fromOptions(): SelOpt[] {
    const out: SelOpt[] = [];
    for (let i: number = 0; i < this.accIds.length; i++) {
      const id: string = this.accIds[i] as string;
      const opt: SelOpt = { value: this.accNameOf(id) };
      out.push(opt);
    }
    return out;
  }

  private toOptions(): SelOpt[] {
    const out: SelOpt[] = [];
    for (let i: number = 0; i < this.accIds.length; i++) {
      const id: string = this.accIds[i] as string;
      const opt: SelOpt = { value: this.accNameOf(id) };
      out.push(opt);
    }
    return out;
  }

  build() {
    Column({ space: 8 }) {
      Text('转账').fontSize(20);
      Text('转账只改两账户余额，不计入收支。').fontSize(12).fontColor('#5f6b7a');
      if (this.loading) {
        Text('加载中…');
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#c92a2a');
        }
        TextInput({ placeholder: '金额（元）', text: this.amountText })
          .inputFilter('^[0-9.]*$')
          .onChange((v: string) => { this.amountText = v; });
        Row({ space: 8 }) {
          Select(this.fromOptions())
            .value(this.accNameOrDefault(this.fromId, '转出账户'))
            .onSelect((idx: number) => {
              const picked: string | undefined = this.accIds[idx];
              if (picked !== undefined) {
                this.fromId = picked as string;
              }
            })
            .layoutWeight(1);
          Text('→');
          Select(this.toOptions())
            .value(this.accNameOrDefault(this.toId, '转入账户'))
            .onSelect((idx: number) => {
              const picked: string | undefined = this.accIds[idx];
              if (picked !== undefined) {
                this.toId = picked as string;
              }
            })
            .layoutWeight(1);
        }.width('100%');
        TextInput({ placeholder: '日期（YYYY-MM-DD）', text: this.dateText })
          .onChange((v: string) => { this.dateText = v; });
        TextInput({ placeholder: '备注', text: this.note })
          .onChange((v: string) => { this.note = v; });
        Button('新增转账', { type: ButtonType.Capsule }).width('100%').onClick(() => {
          this.create();
        });
        List({ space: 4 }) {
          ForEach(this.items, (t: TransferItem) => {
            ListItem() {
              Row() {
                Column() {
                  Text(`${this.accNameOrEmpty(t.fromAccountId)} → ${this.accNameOrEmpty(t.toAccountId)}`)
                    .fontSize(14).layoutWeight(1);
                  Text(`${formatDay(t.date)}${t.note ? ' · ' + t.note : ''}`)
                    .fontSize(12).fontColor('#5f6b7a');
                }.layoutWeight(1);
                Text(formatYuan(t.amountCents)).fontSize(14);
                Button('删除', { type: ButtonType.Normal }).onClick(() => {
                  this.remove(t.id);
                });
              }.width('100%').padding(8);
            }
          });
        }.width('100%').layoutWeight(1);
      }
    }.width('100%').height('100%').padding(16);
  }
}

@Component
export struct TrashView {
  @State items: TrashItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  private ledger: LedgerRepository = new LedgerRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const text: string = await this.ledger.listTrash();
      const raw: TrashListResp = JSON.parse(text) as TrashListResp;
      const items: TrashItem[] = raw.items ?? [];
      this.items = items;
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

  async restore(id: string): Promise<void> {
    try {
      await this.ledger.restore(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async purge(id: string): Promise<void> {
    try {
      await this.ledger.purge(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('回收站').fontSize(20);
      Text('仅账单有回收站，转账删除即消失。').fontSize(12).fontColor('#5f6b7a');
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.reload(); });
      } else if (this.items.length === 0) {
        Text('回收站是空的').fontColor('#5f6b7a');
      } else {
        Row({ space: 8 }) {
          Button('全部恢复', { type: ButtonType.Normal }).onClick(async () => {
            try {
              await this.ledger.restoreAll();
              await this.reload();
            } catch (e) {
              this.error = e instanceof Error ? e.message : String(e);
            }
          });
          Button('全部彻底删除', { type: ButtonType.Normal }).onClick(async () => {
            try {
              await this.ledger.purgeAll();
              await this.reload();
            } catch (e) {
              this.error = e instanceof Error ? e.message : String(e);
            }
          });
        }.width('100%');
        List({ space: 4 }) {
          ForEach(this.items, (t: TrashItem) => {
            ListItem() {
              Row() {
                Column() {
                  Text(t.note !== '' ? t.note : '(无备注)').fontSize(14).layoutWeight(1);
                  Text(formatDay(t.date)).fontSize(12).fontColor('#5f6b7a');
                }.layoutWeight(1);
                Text(`${t.type === 1 ? '+' : '-'}${formatYuan(t.amountCents)}`).fontSize(14);
                Button('恢复', { type: ButtonType.Normal }).onClick(() => {
                  this.restore(t.id);
                });
                Button('彻底删除', { type: ButtonType.Normal }).onClick(() => {
                  this.purge(t.id);
                });
              }.width('100%').padding(8);
            }
          });
        }.width('100%').layoutWeight(1);
      }
    }.width('100%').height('100%').padding(16);
  }
}
