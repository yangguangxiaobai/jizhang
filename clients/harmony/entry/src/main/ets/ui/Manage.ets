// Master-data management (H2): categories / accounts / tags.
// Mirrors Android ManageTab + web ManageView: builtin renamable not deletable,
// delete confirm surfaces usage count; balances are server figures.

import { ApiError } from '../net/ApiClient';
import { AdminRepository, BudgetRepository, MetaRepository, RecurringRepository } from '../repo/Repositories';
import { TagListResp, TagCountResp, UsageResp, BalanceListResp, BalanceRowResp } from './api-types';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

export interface Cat {
  id: string;
  name: string;
  type: number;
  builtin: boolean;
}

export interface CatListResp {
  items: Cat[];
}

export interface Acc {
  id: string;
  name: string;
  type: number;
}

export interface AccListResp {
  items: Acc[];
}

export interface BalEntry {
  id: string;
  cents: number;
}

export interface CatCreateBody {
  name: string;
  type: number;
}

export interface CatRenameBody {
  name: string;
}

export interface RuleItem {
  id: string;
  note: string;
  enabled: boolean;
}

export interface RuleListResp {
  items: RuleItem[];
}

@Component
export struct ManageView {
  @State tab: string = 'categories';
  @State cats: Cat[] = [];
  @State accs: Acc[] = [];
  @State balances: BalEntry[] = [];
  @State tags: string[] = [];
  @State loading: boolean = true;
  @State error: string = '';
  @State newName: string = '';
  @State newType: number = 0;
  @State renameId: string = '';
  @State renameText: string = '';

  private admin: AdminRepository = new AdminRepository();
  private meta: MetaRepository = new MetaRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const catsText: string = await this.admin.categories();
      const catsRaw: CatListResp = JSON.parse(catsText) as CatListResp;
      const cats: Cat[] = catsRaw.items ?? [];
      this.cats = cats;
      const accsText: string = await this.admin.accounts();
      const accsRaw: AccListResp = JSON.parse(accsText) as AccListResp;
      const accs: Acc[] = accsRaw.items ?? [];
      this.accs = accs;
      try {
        const bText: string = await this.meta.balances();
        const b: BalanceListResp = JSON.parse(bText) as BalanceListResp;
        const bm: BalEntry[] = [];
        const rows: BalanceRowResp[] = b.items ?? [];
        for (let i: number = 0; i < rows.length; i++) {
          const row: BalanceRowResp = rows[i] as BalanceRowResp;
          const one: BalEntry = { id: row.accountId, cents: row.balanceCents };
          bm.push(one);
        }
        this.balances = bm;
      } catch (e) {
        hilog.error(0x0000, 'jizhang', 'balances load failed: %{public}s', String(e));
        // Balances are nice-to-have; list still renders.
      }
      const tgText: string = await this.meta.tags();
      const tg: TagListResp = JSON.parse(tgText) as TagListResp;
      const rawItems: Array<string | TagCountResp> = tg.items ?? [];
      const got: string[] = [];
      for (let i: number = 0; i < rawItems.length; i++) {
        const t: string | TagCountResp = rawItems[i] as string | TagCountResp;
        if (typeof t === 'string') {
          got.push(t);
        } else {
          got.push((t as TagCountResp).name);
        }
      }
      this.tags = got;
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

  async createCat(): Promise<void> {
    const name: string = this.newName.trim();
    if (!name) {
      return;
    }
    try {
      const body: CatCreateBody = { name: name, type: this.newType };
      await this.admin.createCategory(body);
      this.newName = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async renameCat(): Promise<void> {
    if (!this.renameId || !this.renameText.trim()) {
      return;
    }
    try {
      const body: CatRenameBody = { name: this.renameText.trim() };
      await this.admin.updateCategory(this.renameId, body);
      this.renameId = '';
      this.renameText = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async deleteCat(id: string, name: string): Promise<void> {
    try {
      const usageText: string = await this.admin.categoryUsage(id);
      const usage: UsageResp = JSON.parse(usageText) as UsageResp;
      let count: number = 0;
      const c1: number | undefined = usage.transactions;
      if (c1 !== undefined) {
        count = c1;
      } else {
        const c2: number | undefined = usage.count;
        if (c2 !== undefined) {
          count = c2;
        } else {
          const c3: number | undefined = usage.total;
          count = c3 === undefined ? 0 : c3;
        }
      }
      // Native confirm sheet would be ideal; inline two-tap: first tap arms.
      if (this.renameId !== `del:${id}`) {
        this.renameId = `del:${id}`;
        this.error = `删除「${name}」？有 ${count} 笔账单引用，再点一次确认删除。`;
        return;
      }
      await this.admin.removeCategory(id);
      this.renameId = '';
      this.error = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async createAcc(): Promise<void> {
    const name: string = this.newName.trim();
    if (!name) {
      return;
    }
    try {
      await this.admin.createAccount(name, this.newType, 0);
      this.newName = '';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('分类与账户').fontSize(20);
      Row({ space: 8 }) {
        Button(this.tab === 'categories' ? '● 分类' : '分类', { type: ButtonType.Normal })
          .onClick(() => { this.tab = 'categories'; });
        Button(this.tab === 'accounts' ? '● 账户' : '账户', { type: ButtonType.Normal })
          .onClick(() => { this.tab = 'accounts'; });
        Button(this.tab === 'tags' ? '● 标签' : '标签', { type: ButtonType.Normal })
          .onClick(() => { this.tab = 'tags'; });
      }.width('100%');
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '' && this.cats.length === 0 && this.accs.length === 0) {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.reload(); });
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#b7791f');
        }
        if (this.tab === 'categories') {
          Row({ space: 8 }) {
            TextInput({ placeholder: '新分类名', text: this.newName })
              .layoutWeight(1)
              .onChange((v: string) => { this.newName = v; });
            Button(this.newType === 0 ? '支出' : '收入', { type: ButtonType.Normal })
              .onClick(() => { this.newType = this.newType === 0 ? 1 : 0; });
            Button('新增').onClick(() => { this.createCat(); });
          }.width('100%');
          List({ space: 4 }) {
            ForEach(this.cats, (c: Cat) => {
              ListItem() {
                Column() {
                  Row() {
                    Text(`${c.name}${c.type === 1 ? ' · 收入' : ' · 支出'}${c.builtin ? ' · 内建' : ''}`)
                      .fontSize(14).layoutWeight(1);
                    Button('改名', { type: ButtonType.Normal }).onClick(() => {
                      this.renameId = c.id;
                      this.renameText = c.name;
                    });
                    if (!c.builtin) {
                      Button('删除', { type: ButtonType.Normal }).onClick(() => {
                        this.deleteCat(c.id, c.name);
                      });
                    }
                  }.width('100%');
                  if (this.renameId === c.id) {
                    Row({ space: 8 }) {
                      TextInput({ placeholder: '新名称', text: this.renameText })
                        .layoutWeight(1)
                        .onChange((v: string) => { this.renameText = v; });
                      Button('保存').onClick(() => { this.renameCat(); });
                    }.width('100%');
                  }
                }.width('100%').padding(8);
              }
            });
          }.width('100%').layoutWeight(1);
        } else if (this.tab === 'accounts') {
          Row({ space: 8 }) {
            TextInput({ placeholder: '新账户名', text: this.newName })
              .layoutWeight(1)
              .onChange((v: string) => { this.newName = v; });
            Button('新增').onClick(() => { this.createAcc(); });
          }.width('100%');
          List({ space: 4 }) {
            ForEach(this.accs, (a: Acc) => {
              ListItem() {
                Row() {
                  Text(a.name).fontSize(14).layoutWeight(1);
                  Text(this.balText(a.id)).fontSize(13).fontColor('#5f6b7a');
                }.width('100%').padding(8);
              }
            });
          }.width('100%').layoutWeight(1);
        } else {
          List({ space: 4 }) {
            ForEach(this.tags, (t: string) => {
              ListItem() {
                Text(t).fontSize(14).width('100%').padding(8);
              }
            });
          }.width('100%').layoutWeight(1);
          Text('标签重命名/删除请在 Web 端或后续版本操作。').fontSize(12).fontColor('#5f6b7a');
        }
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }

  private balText(id: string): string {
    let found: number | undefined = undefined;
    for (let i: number = 0; i < this.balances.length; i++) {
      const one: BalEntry = this.balances[i] as BalEntry;
      if (one.id === id) {
        found = one.cents;
      }
    }
    if (found === undefined) {
      return '—';
    }
    const n: number = found as number;
    const sign: string = n < 0 ? '-' : '';
    const abs: number = Math.abs(n);
    return `${sign}${Math.floor(abs / 100)}.${abs % 100 < 10 ? '0' : ''}${abs % 100}`;
  }
}

export interface TemplateItem {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface TemplateListResp {
  items: TemplateItem[];
}

// Allocation templates (H2): list + default + apply-to-current.
@Component
export struct TemplatesView {
  @State items: TemplateItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const repo: BudgetRepository = new BudgetRepository();
      const text: string = await repo.templates();
      const raw: TemplateListResp = JSON.parse(text) as TemplateListResp;
      const items: TemplateItem[] = raw.items ?? [];
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

  async setDefault(id: string): Promise<void> {
    try {
      await new BudgetRepository().setDefaultTemplate(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async applyCurrent(id: string): Promise<void> {
    try {
      await new BudgetRepository().applyTemplateToCurrent(id);
      this.error = '已应用到当前周期。';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('分配模板').fontSize(20);
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '' && this.items.length === 0) {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.reload(); });
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#2f6f8f');
        }
        List({ space: 6 }) {
          ForEach(this.items, (t: TemplateItem) => {
            ListItem() {
              Column({ space: 4 }) {
                Row() {
                  Text(`${t.name}${t.isDefault ? ' · 默认' : ''}`).fontSize(15).layoutWeight(1);
                }.width('100%');
                Row({ space: 8 }) {
                  if (!t.isDefault) {
                    Button('设为默认', { type: ButtonType.Normal }).onClick(() => {
                      this.setDefault(t.id);
                    });
                  }
                  Button('应用到当前周期', { type: ButtonType.Normal }).onClick(() => {
                    this.applyCurrent(t.id);
                  });
                }
              }.width('100%').padding(12)
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

// Recurring rules (H2): list + enable/disable + delete. Creation mirrors web
// rule fields minimally (note/amount/category/account/cadence) — full editor later.
@Component
export struct RecurringRulesView {
  @State items: RuleItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const text: string = await new RecurringRepository().rules();
      const raw: RuleListResp = JSON.parse(text) as RuleListResp;
      const items: RuleItem[] = raw.items ?? [];
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

  async toggle(id: string, enabled: boolean): Promise<void> {
    try {
      await new RecurringRepository().setEnabled(id, !enabled);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await new RecurringRepository().removeRule(id);
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('周期账单规则').fontSize(20);
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '' && this.items.length === 0) {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.reload(); });
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#c92a2a');
        }
        if (this.items.length === 0) {
          Text('暂无规则，可在 Web 端创建后在此管理。').fontSize(13).fontColor('#5f6b7a');
        }
        List({ space: 6 }) {
          ForEach(this.items, (r: RuleItem) => {
            ListItem() {
              Row() {
                Text(`${r.note || '周期规则'}${r.enabled ? '' : ' · 已停用'}`)
                  .fontSize(14).layoutWeight(1);
                Button(r.enabled ? '停用' : '启用', { type: ButtonType.Normal }).onClick(() => {
                  this.toggle(r.id, r.enabled);
                });
                Button('删除', { type: ButtonType.Normal }).onClick(() => {
                  this.remove(r.id);
                });
              }.width('100%').padding(10)
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
