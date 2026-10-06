// Post-login shell (H2). Mirrors Android MainShell + web AppShell.vue:
// six tabs 首页 / 账单 / 预算 / AI 助理 / 统计 / 我的, record-entry lives
// inside 首页/账单, salary/pending are inline modes, 我的 hosts sub-sections.

import { DashboardView } from '../ui/DashboardView';
import { TransactionsView } from '../ui/TransactionsView';
import { TransactionEditView } from '../ui/TransactionEdit';
import { BudgetView } from '../ui/BudgetView';
import { SalaryView, PendingView } from '../ui/SalaryPending';
import { StatsView } from '../ui/StatsView';
import { AssistantView } from '../ui/AssistantView';
import { ManageView, TemplatesView, RecurringRulesView } from '../ui/Manage';
import { TransfersView, TrashView } from '../ui/TransfersTrash';
import { DataView } from '../ui/DataView';
import { ItemsView } from '../ui/ItemsView';
import { MySection } from '../ui/api-types';
import { themeTokens } from '../ui/theme';
import { clearSession } from '../net/ApiClient';
import { AuthRepository } from '../repo/AuthRepository';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

@Entry
@Component
struct Index {
  @State tab: number = 0;
  @State txMode: number = 0; // 0=list 1=new 2=edit
  @State editId: string = '';
  @State salaryMode: boolean = false;
  @State showPending: boolean = false;
  @State mySection: string = 'home';
  @State preset: string = 'titanium';
  @State curPwd: string = '';
  @State newPwd: string = '';
  @State settingsMsg: string = '';
  private auth: AuthRepository = new AuthRepository();

  aboutToAppear(): void {
    this.auth.refresh();
  }

  private async doLogout(): Promise<void> {
    try {
      await this.auth.logout();
    } catch (e) {
      hilog.error(0x0000, 'jizhang', 'logout failed: %{public}s', String(e));
    }
    await clearSession();
    router.replaceUrl({ url: 'pages/Login' });
  }

  private async doChangePwd(): Promise<void> {
    this.settingsMsg = '';
    if (!this.curPwd || !this.newPwd) {
      this.settingsMsg = '请填写原密码与新密码';
      return;
    }
    try {
      await this.auth.changePassword(this.curPwd, this.newPwd);
      this.settingsMsg = '密码已修改，请重新登录';
      this.curPwd = '';
      this.newPwd = '';
    } catch (e) {
      this.settingsMsg = e instanceof Error ? e.message : String(e);
    }
  }

  private tabLabels(): string[] {
    const labels: string[] = ['首页', '账单', '预算', 'AI 助理', '统计', '我的'];
    return labels;
  }

  private mySections(): MySection[] {
    const a: MySection = { key: 'settings', label: '设置（外观/密码）' };
    const b: MySection = { key: 'items', label: '物品资产' };
    const c: MySection = { key: 'manage', label: '分类与账户' };
    const d: MySection = { key: 'templates', label: '分配模板' };
    const e: MySection = { key: 'recurring', label: '周期账单规则' };
    const f: MySection = { key: 'transfers', label: '转账' };
    const g: MySection = { key: 'trash', label: '回收站' };
    const h: MySection = { key: 'data', label: '数据导出与备份' };
    const out: MySection[] = [a, b, c, d, e, f, g, h];
    return out;
  }

  @Builder
  private TabBar() {
    Row() {
      ForEach(this.tabLabels(), (label: string, idx: number) => {
        Column() {
          Text(label)
            .fontSize(12)
            .fontColor(this.tab === (idx as number) ? themeTokens(this.preset).accent : '#5f6b7a');
        }
        .layoutWeight(1)
        .padding({ top: 10, bottom: 10 })
        .backgroundColor(this.tab === (idx as number) ? '#eef4f7' : '#ffffff')
        .borderRadius(12)
        .onClick(() => {
          this.tab = idx as number;
          this.txMode = 0;
          this.salaryMode = false;
          this.showPending = false;
        });
      });
    }
    .width('100%')
    .padding({ left: 8, right: 8, top: 6, bottom: 6 })
    .backgroundColor('#ffffff')
    .border({ width: { top: 1 }, color: '#e3e6ea' });
  }

  @Builder
  private MyHome() {
    Column({ space: 8 }) {
      Text('我的').fontSize(22);
      ForEach(this.mySections(), (it: MySection) => {
        Button(it.label, { type: ButtonType.Normal })
          .width('100%')
          .onClick(() => {
            this.mySection = it.key;
          });
      });
      Button('退出登录').width('100%').margin({ top: 8 }).onClick(() => {
        this.doLogout();
      });
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }

  @Builder
  private MySection() {
    Column() {
      Button('‹ 返回我的', { type: ButtonType.Normal })
        .margin(16)
        .onClick(() => {
          this.mySection = 'home';
        });
      if (this.mySection === 'manage') {
        ManageView();
      } else if (this.mySection === 'templates') {
        TemplatesView();
      } else if (this.mySection === 'recurring') {
        RecurringRulesView();
      } else if (this.mySection === 'transfers') {
        TransfersView();
      } else if (this.mySection === 'trash') {
        TrashView();
      } else if (this.mySection === 'data') {
        DataView();
      } else if (this.mySection === 'items') {
        ItemsView();
      } else if (this.mySection === 'settings') {
        Column({ space: 10 }) {
          Text('外观').fontSize(16);
          Row({ space: 8 }) {
            Button('钛蓝').onClick(() => { this.preset = 'titanium'; });
            Button('森林绿').onClick(() => { this.preset = 'forest'; });
            Button('极简黑白').onClick(() => { this.preset = 'mono'; });
          }.width('100%');
          Text(`当前：${this.preset}`).fontSize(12).fontColor('#5f6b7a');
          Text('修改密码').fontSize(16);
          TextInput({ placeholder: '原密码', text: this.curPwd })
            .type(InputType.Password)
            .onChange((v: string) => { this.curPwd = v; });
          TextInput({ placeholder: '新密码', text: this.newPwd })
            .type(InputType.Password)
            .onChange((v: string) => { this.newPwd = v; });
          if (this.settingsMsg !== '') {
            Text(this.settingsMsg).fontSize(12).fontColor('#2f6f8f');
          }
          Button('确认修改').width('100%').onClick(() => { this.doChangePwd(); });
        }
        .width('100%')
        .height('100%')
        .padding(16);
      }
    }
    .width('100%')
    .height('100%');
  }

  build() {
    Column() {
      if (this.tab === 0) {
        if (this.showPending) {
          PendingView();
        } else {
          DashboardView({
            onSeeAll: () => { this.tab = 1; },
            onNewTx: () => { this.tab = 1; this.txMode = 1; },
            onPending: () => { this.showPending = true; },
          });
        }
      } else if (this.tab === 1) {
        if (this.txMode === 1) {
          TransactionEditView({
            onSaved: () => { this.txMode = 0; },
            onClose: () => { this.txMode = 0; },
          });
        } else if (this.txMode === 2) {
          TransactionEditView({
            editId: this.editId,
            onSaved: () => { this.txMode = 0; this.editId = ''; },
            onClose: () => { this.txMode = 0; this.editId = ''; },
          });
        } else {
          TransactionsView({
            onNew: () => { this.txMode = 1; },
            onEdit: (id: string) => { this.editId = id; this.txMode = 2; },
          });
        }
      } else if (this.tab === 2) {
        if (this.salaryMode) {
          SalaryView({
            onSaved: () => { this.salaryMode = false; },
            onClose: () => { this.salaryMode = false; },
          });
        } else {
          BudgetView({ onNewSalary: () => { this.salaryMode = true; } });
        }
      } else if (this.tab === 3) {
        AssistantView();
      } else if (this.tab === 4) {
        StatsView();
      } else {
        if (this.mySection === 'home') {
          this.MyHome();
        } else {
          this.MySection();
        }
      }
      this.TabBar();
    }
    .width('100%')
    .height('100%')
    .backgroundColor(themeTokens(this.preset).bg);
  }
}
