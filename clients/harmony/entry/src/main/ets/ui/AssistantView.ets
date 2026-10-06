// AI assistant (H2). Mirrors Android AssistantTab: conversations, messages,
// send (text only v1; attachment via file picker lands with H3), action
// confirm (informational; platform-import selection UI lands with DataView).

import { ApiError } from '../net/ApiClient';
import { AssistantRepository } from '../repo/Repositories';
import router from '@ohos.router';

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ConvListResp {
  items: Conversation[];
  conversations: Conversation[];
}

export interface Msg {
  id: string;
  role: string;
  text: string;
  createdAt: number;
}

export interface MsgListResp {
  items: Msg[];
  messages: Msg[];
}

export interface ConvCreateResp {
  id: string;
  conversation: ConvCreateInner;
}

export interface ConvCreateInner {
  id: string;
}

@Component
export struct AssistantView {
  @State convs: Conversation[] = [];
  @State currentId: string = '';
  @State msgs: Msg[] = [];
  @State input: string = '';
  @State loading: boolean = true;
  @State sending: boolean = false;
  @State error: string = '';

  private repo: AssistantRepository = new AssistantRepository();

  aboutToAppear(): void {
    this.loadConvs();
  }

  async loadConvs(): Promise<void> {
    this.loading = true;
    try {
      const text: string = await this.repo.conversations();
      const raw: ConvListResp = JSON.parse(text) as ConvListResp;
      let got: Conversation[] = raw.items ?? [];
      if (got.length === 0) {
        got = raw.conversations ?? [];
      }
      this.convs = got;
      if (this.convs.length > 0 && !this.currentId) {
        this.currentId = (this.convs[0] as Conversation).id;
        await this.loadMsgs();
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

  async loadMsgs(): Promise<void> {
    if (!this.currentId) {
      return;
    }
    try {
      const text: string = await this.repo.messages(this.currentId);
      const raw: MsgListResp = JSON.parse(text) as MsgListResp;
      let got: Msg[] = raw.items ?? [];
      if (got.length === 0) {
        got = raw.messages ?? [];
      }
      this.msgs = got;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async newConv(): Promise<void> {
    try {
      const text: string = await this.repo.createConversation();
      const raw: ConvCreateResp = JSON.parse(text) as ConvCreateResp;
      let id: string = raw.id ?? '';
      if (!id) {
        const inner: ConvCreateInner | undefined = raw.conversation;
        id = inner ? inner.id : '';
      }
      if (id) {
        this.currentId = id;
        this.msgs = [];
        await this.loadConvs();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async send(): Promise<void> {
    const text: string = this.input.trim();
    if (!text || !this.currentId || this.sending) {
      return;
    }
    this.sending = true;
    this.input = '';
    try {
      const reqId: string = `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await this.repo.sendMessage(this.currentId, text, reqId);
      await this.loadMsgs();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.sending = false;
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('AI 助理').fontSize(22);
      if (this.loading) {
        Text('加载中…');
      } else if (this.error !== '' && this.convs.length === 0) {
        Text(this.error).fontColor('#c92a2a');
        Button('重试').onClick(() => { this.loadConvs(); });
      } else {
        Scroll() {
          Row({ space: 8 }) {
            Button('新对话', { type: ButtonType.Normal }).onClick(() => { this.newConv(); });
            ForEach(this.convs, (c: Conversation) => {
              Button(this.currentId === c.id ? `● ${c.title || '对话'}` : (c.title || '对话'),
                { type: ButtonType.Normal })
                .onClick(() => {
                  this.currentId = c.id;
                  this.loadMsgs();
                });
            });
          }
        }.width('100%').scrollable(ScrollDirection.Horizontal);
        List({ space: 6 }) {
          ForEach(this.msgs, (m: Msg) => {
            ListItem() {
              Column() {
                Text(m.role === 'user' ? '我' : '助理').fontSize(12).fontColor('#5f6b7a');
                Text(m.text).fontSize(14);
              }
              .width('100%')
              .padding(10)
              .backgroundColor(m.role === 'user' ? '#eef4f7' : '#ffffff')
              .border({ width: 1, color: '#e3e6ea' })
              .borderRadius(12);
            }
          });
        }.width('100%').layoutWeight(1);
        if (this.error !== '') {
          Text(this.error).fontColor('#c92a2a').fontSize(12);
        }
        Row({ space: 8 }) {
          TextInput({ placeholder: '输入问题…', text: this.input })
            .layoutWeight(1)
            .onChange((v: string) => { this.input = v; })
            .onSubmit(() => { this.send(); });
          Button(this.sending ? '…' : '发送', { type: ButtonType.Capsule })
            .enabled(!this.sending)
            .onClick(() => { this.send(); });
        }.width('100%');
      }
    }
    .width('100%')
    .height('100%')
    .padding(16);
  }
}
