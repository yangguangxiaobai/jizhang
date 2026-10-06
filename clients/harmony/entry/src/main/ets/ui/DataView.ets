// Data portability (H2). Mirrors Android DataTab + web DataView four cards:
// export (download w/ cookie) / app-CSV import / platform bills / backups.
// Restore has NO endpoint — show CLI command only (design N7).

import { ApiError } from '../net/ApiClient';
import { PortabilityRepository } from '../repo/Repositories';
import router from '@ohos.router';

const RESTORE_COMMAND: string =
  'docker compose stop jizhang\n' +
  'docker compose run --rm jizhang node /app/packages/server/dist/cli.js restore /data/backups/<文件名>\n' +
  'docker compose start jizhang';

export interface BackupItem {
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupListResp {
  items: BackupItem[];
}

@Component
export struct DataView {
  @State backups: BackupItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';
  @State info: string = '';
  @State importMode: string = 'transactions';
  @State csvText: string = '';
  @State busy: boolean = false;

  private repo: PortabilityRepository = new PortabilityRepository();

  aboutToAppear(): void {
    this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      const text: string = await this.repo.listBackups();
      const raw: BackupListResp = JSON.parse(text) as BackupListResp;
      const items: BackupItem[] = raw.items ?? [];
      this.backups = items;
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

  async doExport(what: string): Promise<void> {
    this.busy = true;
    this.info = '';
    try {
      const bytes: ArrayBuffer = await this.repo.downloadExport(what);
      this.info = `已下载 ${what}.csv（${bytes.byteLength} 字节），请用文件管理查看下载目录。`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  async doImportCsv(): Promise<void> {
    if (!this.csvText.trim()) {
      this.error = '请先粘贴 CSV 内容';
      return;
    }
    this.busy = true;
    try {
      let res: string = '';
      if (this.importMode === 'transactions') {
        res = await this.repo.importTransactionsCsv(this.csvText);
      } else {
        res = await this.repo.importTransfersCsv(this.csvText);
      }
      this.info = `导入完成：${res}`;
      this.csvText = '';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  async doBackup(): Promise<void> {
    this.busy = true;
    try {
      await this.repo.createBackup();
      this.info = '备份已创建。';
      await this.reload();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column({ space: 10 }) {
      Text('数据导出与备份').fontSize(20);
      if (this.loading) {
        Text('加载中…');
      } else {
        if (this.error !== '') {
          Text(this.error).fontSize(12).fontColor('#c92a2a');
        }
        if (this.info !== '') {
          Text(this.info).fontSize(12).fontColor('#2f6f8f');
        }
        Scroll() {
          Column({ space: 10 }) {
            Text('导出').fontSize(16);
            Text('下载 CSV，可直接用 Excel 打开（中文不会乱码）。').fontSize(12).fontColor('#5f6b7a');
            Row({ space: 8 }) {
              Button('账单', { type: ButtonType.Normal }).onClick(() => { this.doExport('transactions'); });
              Button('工资', { type: ButtonType.Normal }).onClick(() => { this.doExport('salaries'); });
            }.width('100%');
            Row({ space: 8 }) {
              Button('周期规则', { type: ButtonType.Normal }).onClick(() => { this.doExport('recurring'); });
              Button('转账', { type: ButtonType.Normal }).onClick(() => { this.doExport('transfers'); });
            }.width('100%');

            Text('本应用 CSV 导入').fontSize(16);
            Row({ space: 8 }) {
              Button(this.importMode === 'transactions' ? '● 账单' : '账单', { type: ButtonType.Normal })
                .onClick(() => { this.importMode = 'transactions'; });
              Button(this.importMode === 'transfers' ? '● 转账' : '转账', { type: ButtonType.Normal })
                .onClick(() => { this.importMode = 'transfers'; });
            }.width('100%');
            TextArea({ placeholder: '粘贴 CSV 全文（含表头）', text: this.csvText })
              .height(90)
              .onChange((v: string) => { this.csvText = v; });
            Button('导入', { type: ButtonType.Capsule }).width('100%')
              .enabled(!this.busy)
              .onClick(() => { this.doImportCsv(); });
            Text('平台账单（微信/支付宝）请走 AI 助理附件或后续版本文件选择器，解析走服务端。')
              .fontSize(12).fontColor('#5f6b7a');

            Text('备份').fontSize(16);
            Button(this.busy ? '处理中…' : '立即备份', { type: ButtonType.Capsule })
              .width('100%').enabled(!this.busy).onClick(() => { this.doBackup(); });
            ForEach(this.backups, (b: BackupItem) => {
              Text(`${b.name} · ${Math.round(b.size / 1024)} KB`).fontSize(13);
            });
            Text('恢复（需停服执行，仅 CLI）：').fontSize(13);
            Text(RESTORE_COMMAND).fontSize(11).fontColor('#5f6b7a');
          }.width('100%');
        }.width('100%').layoutWeight(1);
      }
    }.width('100%').height('100%').padding(16);
  }
}
