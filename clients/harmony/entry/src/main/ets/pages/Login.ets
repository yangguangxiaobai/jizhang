// H1 login page: server URL + username + password, wired to AuthRepository.
// baseURL is user-configured + remembered, never hardcoded (parent PRD R3).
// Single account: no sign-up affordance (account comes from `set-password` CLI).

import { getBaseUrl, setBaseUrl, looksLikeUrl } from '../net/ApiClient';
import { AuthRepository } from '../repo/AuthRepository';
import router from '@ohos.router';
import { hilog } from '@kit.PerformanceAnalysisKit';

@Entry
@Component
struct Login {
  @State serverUrl: string = '';
  @State username: string = '';
  @State password: string = '';
  @State loading: boolean = false;
  @State checking: boolean = true;
  @State error: string = '';
  private auth: AuthRepository = new AuthRepository();

  aboutToAppear(): void {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      this.serverUrl = await getBaseUrl();
    } catch (e) {
      hilog.error(0x0000, 'jizhang', 'load base url failed: %{public}s', String(e));
      this.serverUrl = '';
    }
    await this.auth.refresh();
    this.checking = false;
    if (this.auth.username !== '') {
      router.replaceUrl({ url: 'pages/Index' });
    }
  }

  async submit(): Promise<void> {
    this.error = '';
    if (this.serverUrl.trim() === '') {
      this.error = '请先填写服务端地址';
      return;
    }
    if (!looksLikeUrl(this.serverUrl)) {
      this.error = '服务端地址须以 http(s):// 开头';
      return;
    }
    if (this.username.trim() === '' || this.password === '') {
      return;
    }
    this.loading = true;
    try {
      await setBaseUrl(this.serverUrl);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.loading = false;
      return;
    }
    const ok = await this.auth.login(this.username.trim(), this.password);
    this.loading = false;
    if (ok) {
      router.replaceUrl({ url: 'pages/Index' });
    } else {
      this.error = this.auth.lastError || '登录失败，请重试。';
    }
  }

  build() {
    Column() {
      if (this.checking) {
        Text('加载中…').margin({ top: 96 });
      } else {
        Text('记账').fontSize(28).margin({ top: 48 });
        Text('信封预算法 · 个人账本').fontColor('#5f6b7a').margin({ bottom: 24 });

        TextInput({ placeholder: '服务端地址（https://…）', text: this.serverUrl })
          .onChange((v: string) => {
            this.serverUrl = v;
          })
          .margin({ bottom: 12 });

        TextInput({ placeholder: '用户名', text: this.username })
          .onChange((v: string) => {
            this.username = v;
          })
          .margin({ bottom: 12 });

        TextInput({ placeholder: '密码', text: this.password })
          .type(InputType.Password)
          .onChange((v: string) => {
            this.password = v;
          })
          .margin({ bottom: 8 });

        if (this.error !== '') {
          Text(this.error).fontColor('#c92a2a').margin({ bottom: 8 });
        }

        Button(this.loading ? '登录中…' : '登录', { stateEffect: true })
          .width('100%')
          .margin({ top: 8 })
          .enabled(!this.loading)
          .onClick(() => {
            this.submit();
          });

        Text('首次使用请在服务器上运行 set-password 设置密码')
          .fontSize(12)
          .fontColor('#5f6b7a')
          .margin({ top: 16 });
      }
    }
    .width('100%')
    .padding(24);
  }
}
