// Transaction create/edit (H2). Mirrors Android TransactionEditSheet + web
// TransactionEditView: yuan text → integer cents (Math.round once), type
// 支出/收入, refund only for income, category/account from master data.

import { ApiError } from '../net/ApiClient';
import { LedgerRepository, MetaRepository } from '../repo/Repositories';
import { SelOpt } from './api-types';
import router from '@ohos.router';

export interface NameItem {
  id: string;
  name: string;
  type: number;
}

export interface CatRespItem {
  id: string;
  name: string;
  type: number;
}

export interface CatListItemsResp {
  items: CatRespItem[];
}

export interface AccountRespItem {
  id: string;
  name: string;
}

export interface AccountListItemsResp {
  items: AccountRespItem[];
}

export interface TxDetailResp {
  type: number;
  amountCents: number;
  categoryId: string;
  accountId: string;
  date: number;
  note: string;
  isRefund: boolean;
}

export interface TxSaveBody {
  type: number;
  amountCents: number;
  categoryId: string;
  accountId: string;
  date: number;
  note: string;
  isRefund: boolean;
}

export function parseYuanToCents(text: string): number | null {
  const v: number = Number(text.trim());
  if (!isFinite(v) || v <= 0) {
    return null;
  }
  return Math.round(v * 100);
}

function todayInput(): string {
  const d: Date = new Date();
  const m: string = `${d.getMonth() + 1}`.padStart(2, '0');
  const day: string = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function toDateInput(epochMs: number): string {
  const d: Date = new Date(epochMs);
  const m: string = `${d.getMonth() + 1}`.padStart(2, '0');
  const day: string = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromDateInput(text: string): number {
  const t: number = Date.parse(text.trim());
  return isNaN(t) ? Date.now() : t;
}

@Component
export struct TransactionEditView {
  @State type: number = 0;
  @State amountText: string = '';
  @State categoryId: string = '';
  @State accountId: string = '';
  @State dateText: string = todayInput();
  @State note: string = '';
  @State isRefund: boolean = false;
  @State expenseCats: NameItem[] = [];
  @State incomeCats: NameItem[] = [];
  @State accounts: NameItem[] = [];
  @State loading: boolean = true;
  @State saving: boolean = false;
  @State error: string = '';
  editId: string = '';
  onSaved: () => void = () => {};
  onClose: () => void = () => {};

  private ledger: LedgerRepository = new LedgerRepository();
  private meta: MetaRepository = new MetaRepository();

  aboutToAppear(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const catsText: string = await this.meta.categories();
      const cats: CatListItemsResp = JSON.parse(catsText) as CatListItemsResp;
      const ex: NameItem[] = [];
      const inc: NameItem[] = [];
      const rawCats: CatRespItem[] = cats.items ?? [];
      for (let i: number = 0; i < rawCats.length; i++) {
        const c: CatRespItem = rawCats[i] as CatRespItem;
        const it: NameItem = { id: c.id, name: c.name, type: c.type };
        if (c.type === 1) {
          inc.push(it);
        } else {
          ex.push(it);
        }
      }
      this.expenseCats = ex;
      this.incomeCats = inc;
      const accsText: string = await this.meta.accounts();
      const accs: AccountListItemsResp = JSON.parse(accsText) as AccountListItemsResp;
      const gotAccs: NameItem[] = [];
      const rawAccs: AccountRespItem[] = accs.items ?? [];
      for (let i: number = 0; i < rawAccs.length; i++) {
        const a: AccountRespItem = rawAccs[i] as AccountRespItem;
        const it: NameItem = { id: a.id, name: a.name, type: 0 };
        gotAccs.push(it);
      }
      this.accounts = gotAccs;
      if (!this.editId) {
        this.categoryId = ex.length > 0 ? (ex[0] as NameItem).id : '';
        this.accountId = this.accounts.length > 0 ? (this.accounts[0] as NameItem).id : '';
      } else {
        const itemText: string = await this.ledger.getTransaction(this.editId);
        const item: TxDetailResp = JSON.parse(itemText) as TxDetailResp;
        const gotType: number | undefined = item.type;
        this.type = gotType === undefined ? 0 : gotType;
        const gotCents: number | undefined = item.amountCents;
        const cents: number = gotCents === undefined ? 0 : gotCents;
        this.amountText = (cents / 100).toFixed(2);
        const gotCat: string | undefined = item.categoryId;
        this.categoryId = gotCat === undefined ? '' : gotCat;
        const gotAcc: string | undefined = item.accountId;
        this.accountId = gotAcc === undefined ? '' : gotAcc;
        const gotDate: number | undefined = item.date;
        this.dateText = toDateInput(gotDate === undefined ? Date.now() : gotDate);
        const gotNote: string | undefined = item.note;
        this.note = gotNote === undefined ? '' : gotNote;
        const gotRefund: boolean | undefined = item.isRefund;
        this.isRefund = gotRefund === undefined ? false : gotRefund;
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

  async save(): Promise<void> {
    const cents: number | null = parseYuanToCents(this.amountText);
    if (cents === null || (cents as number) <= 0) {
      this.error = '金额须为大于 0 的数字';
      return;
    }
    if (!this.categoryId || !this.accountId) {
      this.error = '请选择分类与账户';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const body: TxSaveBody = {
        type: this.type,
        amountCents: cents as number,
        categoryId: this.categoryId,
        accountId: this.accountId,
        date: fromDateInput(this.dateText),
        note: this.note,
        isRefund: this.type === 1 && this.isRefund,
      };
      if (!this.editId) {
        await this.ledger.createTransaction(body);
      } else {
        await this.ledger.updateTransaction(this.editId, body);
      }
      this.onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        router.replaceUrl({ url: 'pages/Login' });
        return;
      }
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.saving = false;
    }
  }

  private catOptions(): SelOpt[] {
    const list: NameItem[] = this.type === 1 ? this.incomeCats : this.expenseCats;
    const out: SelOpt[] = [];
    for (let i: number = 0; i < list.length; i++) {
      const opt: SelOpt = { value: (list[i] as NameItem).name };
      out.push(opt);
    }
    return out;
  }

  private accountOptions(): SelOpt[] {
    const out: SelOpt[] = [];
    for (let i: number = 0; i < this.accounts.length; i++) {
      const opt: SelOpt = { value: (this.accounts[i] as NameItem).name };
      out.push(opt);
    }
    return out;
  }

  build() {
    Column({ space: 10 }) {
      Text(!this.editId ? '记一笔' : '编辑账单').fontSize(20);
      if (this.loading) {
        Text('加载中…');
      } else {
        Row({ space: 8 }) {
          Button(this.type === 0 ? '● 支出' : '支出', { type: ButtonType.Normal })
            .onClick(() => {
              this.type = 0;
              this.isRefund = false;
              if (!this.categoryId && this.expenseCats.length > 0) {
                this.categoryId = (this.expenseCats[0] as NameItem).id;
              }
            });
          Button(this.type === 1 ? '● 收入' : '收入', { type: ButtonType.Normal })
            .onClick(() => {
              this.type = 1;
              if (!this.categoryId && this.incomeCats.length > 0) {
                this.categoryId = (this.incomeCats[0] as NameItem).id;
              }
            });
        }.width('100%');

        TextInput({ placeholder: '金额（元）', text: this.amountText })
          .inputFilter('^[0-9.]*$')
          .onChange((v: string) => {
            this.amountText = v;
          });

        Text('分类').fontSize(12).fontColor('#5f6b7a');
        Select(this.catOptions())
          .value(this.currentCatName())
          .onSelect((idx: number) => {
            const list: NameItem[] = this.type === 1 ? this.incomeCats : this.expenseCats;
            const picked: NameItem | undefined = list[idx];
            if (picked) {
              this.categoryId = (picked as NameItem).id;
            }
          })
          .width('100%');

        Text('账户').fontSize(12).fontColor('#5f6b7a');
        Select(this.accountOptions())
          .value(this.currentAccountName())
          .onSelect((idx: number) => {
            const picked: NameItem | undefined = this.accounts[idx];
            if (picked) {
              this.accountId = (picked as NameItem).id;
            }
          })
          .width('100%');

        TextInput({ placeholder: '日期（YYYY-MM-DD）', text: this.dateText })
          .onChange((v: string) => {
            this.dateText = v;
          });
        TextInput({ placeholder: '备注', text: this.note })
          .onChange((v: string) => {
            this.note = v;
          });

        if (this.type === 1) {
          Button(this.isRefund ? '● 这是退款' : '这是退款', { type: ButtonType.Normal })
            .onClick(() => {
              this.isRefund = !this.isRefund;
            });
        }
        if (this.error !== '') {
          Text(this.error).fontColor('#c92a2a').fontSize(13);
        }
        Button(this.saving ? '保存中…' : '保存', { type: ButtonType.Capsule })
          .width('100%')
          .enabled(!this.saving)
          .onClick(() => {
            this.save();
          });
        Button('取消', { type: ButtonType.Normal })
          .width('100%')
          .onClick(() => {
            this.onClose();
          });
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }

  private currentCatName(): string {
    const list: NameItem[] = this.type === 1 ? this.incomeCats : this.expenseCats;
    const found: NameItem | undefined = list.find((c: NameItem): boolean => c.id === this.categoryId);
    return found ? (found as NameItem).name : '请选择分类';
  }

  private currentAccountName(): string {
    const found: NameItem | undefined = this.accounts.find((a: NameItem): boolean => a.id === this.accountId);
    return found ? (found as NameItem).name : '请选择账户';
  }
}
