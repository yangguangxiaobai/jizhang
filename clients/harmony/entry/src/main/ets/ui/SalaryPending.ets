// Salary entry + pending queue (H2). Mirrors Android SalarySheet/PendingTab:
// accountId REQUIRED for salary; confirm is the only call that puts money in.

import { ApiError } from '../net/ApiClient';
import { BudgetRepository, MetaRepository, RecurringRepository } from '../repo/Repositories';
import { formatYuan, formatDay } from './format';
import { parseYuanToCents } from './TransactionEdit';
import { SelOpt } from './api-types';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface NameItem {
  id: string;
  name: string;
}

export interface AccountRespItem {
  id: string;
  name: string;
}

export interface AccountListResp {
  items: AccountRespItem[];
}

export interface SalaryCreateBody {
  amountCents: number;
  date: number;
  accountId: string;
  note: string;
}

export interface SalaryItem {
  id: string;
  amountCents: number;
  date: number;
  note: string;
}

export interface SalaryListResp {
  items: SalaryItem[];
}

export interface PendingItem {
  id: string;
  amountCents: number;
  plannedDate: number;
  note: string;
}

export interface PendingListResp {
  items: PendingItem[];
}

function todayInput(): string {
  const d: Date = new Date();
  const m: string = `${d.getMonth() + 1}`.padStart(2, '0');
  const day: string = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

@Component
export struct SalaryView {
  onSaved: () => void = () => {};
  onClose: () => void = () => {};
  @State amountText: string = '';
  @State dateText: string = todayInput();
  @State note: string = '';
  @State accountId: string = '';
  @State accounts: NameItem[] = [];
  @State past: SalaryItem[] = [];
  @State saving: boolean = false;
  @State error: string = '';

  private repo: BudgetRepository = new BudgetRepository();
  private meta: MetaRepository = new MetaRepository();

  aboutToAppear(): void {
    this.load();
  }

  async load(): Promise<void> {
    try {
      const accsText: string = await this.meta.accounts();
      const accs: AccountListResp = JSON.parse(accsText) as AccountListResp;
      const got: NameItem[] = [];
      const rawAccs: AccountRespItem[] = accs.items ?? [];
      for (let i: number = 0; i < rawAccs.length; i++) {
        const a: AccountRespItem = rawAccs[i] as AccountRespItem;
        const it: NameItem = { id: a.id, name: a.name };
        got.push(it);
      }
      this.accounts = got;
      if (this.accounts.length > 0) {
        this.accountId = (this.accounts[0] as NameItem).id;
      }
      const salsText: string = await this.repo.salaries();
      const sals: SalaryListResp = JSON.parse(salsText) as SalaryListResp;
      const past: SalaryItem[] = sals.items ?? [];
      this.past = past;
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        router.replaceUrl({ url: 'pages/Login' });
        return;
      }
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async save(): Promise<void> {
    const cents: number | null = parseYuanToCents(this.amountText);
    if (cents === null || (cents as number) <= 0) {
      this.error = '金额须为大于 0 的数字';
      return;
    }
    if (!this.accountId) {
      this.error = '请选择到账账户';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const t: number = Date.parse(this.dateText.trim());
      const body: SalaryCreateBody = {
        amountCents: cents as number,
        date: isNaN(t) ? Date.now() : t,
        accountId: this.accountId,
        note: this.note,
      };
      await this.repo.createSalary(body);
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

  private accountOptions(): SelOpt[] {
    const out: SelOpt[] = [];
    for (let i: number = 0; i < this.accounts.length; i++) {
      const opt: SelOpt = { value: (this.accounts[i] as NameItem).name };
      out.push(opt);
    }
    return out;
  }

  private currentAccountName(): string {
    const found: NameItem | undefined = this.accounts.find((a: NameItem): boolean => a.id === this.accountId);
    return found ? (found as NameItem).name : '请选择账户';
  }

  build() {
    Column({ space: 10 }) {
      Text('记工资').fontSize(20);
      TextInput({ placeholder: '金额（元）', text: this.amountText })
        .inputFilter('^[0-9.]*$')
        .onChange((v: string) => {
          this.amountText = v;
        });
      TextInput({ placeholder: '日期（YYYY-MM-DD）', text: this.dateText })
        .onChange((v: string) => {
          this.dateText = v;
        });
      Text('到账账户').fontSize(12).fontColor('#5f6b7a');
      Select(this.accountOptions())
        .value(this.currentAccountName())
        .onSelect((idx: number) => {
          const picked: NameItem | undefined = this.accounts[idx];
          if (picked) {
            this.accountId = (picked as NameItem).id;
          }
        })
        .width('100%');
      TextInput({ placeholder: '备注', text: this.note })
        .onChange((v: string) => {
          this.note = v;
        });
      if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a').fontSize(13);
      }
      Button(this.saving ? '保存中…' : '保存', { type: ButtonType.Capsule })
        .width('100%')
        .enabled(!this.saving)
        .onClick(() => {
          this.save();
        });
      Button('取消', { type: ButtonType.Normal }).width('100%').onClick(() => {
        this.onClose();
      });
      Text('历史工资').fontSize(16);
      List({ space: 4 }) {
        ForEach(this.past, (s: SalaryItem) => {
          ListItem() {
            Column() {
              Text(`${formatYuan(s.amountCents)} · ${formatDay(s.date)}`).fontSize(14);
              if (s.note !== '') {
                Text(s.note).fontSize(12).fontColor('#5f6b7a');
              }
            }.width('100%').padding({ top: 4, bottom: 4 });
          }
        });
      }.width('100%').layoutWeight(1);
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }
}

@Component
export struct PendingView {
  @State items: PendingItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  private repo: RecurringRepository = new RecurringRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      try {
        await this.repo.generate();
      } catch (e) {
        hilog.error(0x0000, 'jizhang', 'generate warmup failed: %{public}s', String(e));
        // Idempotent warmup; queue read is what matters.
      }
      const resText: string = await this.repo.pending();
      const res: PendingListResp = JSON.parse(resText) as PendingListResp;
      const items: PendingItem[] = res.items ?? [];
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

  async confirm(id: string): Promise<void> {
    try {
      await this.repo.confirm(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async ignore(id: string): Promise<void> {
    try {
      await this.repo.ignore(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('待确认账单').fontSize(20);
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '') {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => {
          this.reload();
        });
      } else if (this.items.length === 0) {
        Text('暂无待确认账单').fontColor('#5f6b7a');
      } else {
        List({ space: 6 }) {
          ForEach(this.items, (occ: PendingItem) => {
            ListItem() {
              Column({ space: 4 }) {
                Row() {
                  Text(occ.note !== '' ? occ.note : '周期账单').fontSize(15).layoutWeight(1);
                  Text(formatYuan(occ.amountCents)).fontSize(15);
                }.width('100%');
                Text(formatDay(occ.plannedDate)).fontSize(12).fontColor('#5f6b7a');
                Row({ space: 8 }) {
                  Button('确认入账', { type: ButtonType.Normal }).onClick(() => {
                    this.confirm(occ.id);
                  });
                  Button('忽略', { type: ButtonType.Normal }).onClick(() => {
                    this.ignore(occ.id);
                  });
                }
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
    .width('100%')
    .height('100%')
    .padding(16);
  }
}
