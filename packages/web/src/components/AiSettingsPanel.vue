<script setup lang="ts">
/**
 * Provider configuration form for the single-user AI assistant.
 *
 * The parent settings view owns API calls; this component owns only the local form draft so
 * an API key is never hydrated from the redacted server summary.
 */
import { ref, watch } from 'vue';
import type {
  AiAuthKind,
  AiHttpMethod,
  AiProviderConfigInput,
  AiProviderConfigSummary,
  AiProviderMode,
} from '../api/client.js';

const props = defineProps<{
  config: AiProviderConfigSummary | null;
  saving: boolean;
  testing: boolean;
  error: string | null;
  success: string | null;
}>();

const emit = defineEmits<{
  save: [input: AiProviderConfigInput];
  test: [];
}>();

const enabled = ref(false);
const mode = ref<AiProviderMode>('chat-completions');
const name = ref('AI 助手');
const url = ref('');
const method = ref<AiHttpMethod>('POST');
const model = ref('');
const timeoutMs = ref(20000);
const authKind = ref<AiAuthKind>('bearer');
const authHeaderName = ref('X-API-Key');
const secret = ref('');
const clearSecret = ref(false);
const headersText = ref('{}');
const bodyTemplate = ref('');
const responsePath = ref('choices[0].message.content');
const localError = ref<string | null>(null);

function defaultResponsePath(value: AiProviderMode): string {
  return value === 'chat-completions' ? 'choices[0].message.content' : value === 'responses' ? 'output_text' : '';
}

function resetFromConfig(config: AiProviderConfigSummary | null): void {
  if (config === null) return;
  enabled.value = config.enabled;
  mode.value = config.mode;
  name.value = config.name || 'AI 助手';
  url.value = config.url;
  method.value = config.method;
  model.value = config.model;
  timeoutMs.value = config.timeoutMs;
  authKind.value = config.auth.kind;
  authHeaderName.value = config.auth.headerName ?? 'X-API-Key';
  secret.value = '';
  clearSecret.value = false;
  headersText.value = JSON.stringify(config.headers, null, 2);
  bodyTemplate.value = config.bodyTemplate ?? '';
  responsePath.value = config.responsePath || defaultResponsePath(config.mode);
}

watch(() => props.config, resetFromConfig, { immediate: true });

function onModeChange(): void {
  if (mode.value !== 'custom') {
    method.value = 'POST';
    bodyTemplate.value = '';
    responsePath.value = defaultResponsePath(mode.value);
  } else if (bodyTemplate.value === '') {
    bodyTemplate.value =
      '{\n  "model": "{{model}}",\n  "messages": [{\n    "role": "user",\n    "content": "{{input}}"\n  }]\n}';
    responsePath.value = 'choices[0].message.content';
  }
}

function submit(): void {
  localError.value = null;
  let headers: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(headersText.value || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('请求头必须是 JSON 对象。');
    }
    headers = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') throw new Error(`请求头 ${key} 的值必须是文本。`);
      headers[key] = value;
    }
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '请求头 JSON 格式无效。';
    return;
  }

  const input: AiProviderConfigInput = {
    enabled: enabled.value,
    mode: mode.value,
    name: name.value,
    url: url.value,
    method: method.value,
    model: model.value,
    timeoutMs: timeoutMs.value,
    headers,
    auth: {
      kind: authKind.value,
      ...(authKind.value === 'header' ? { headerName: authHeaderName.value } : {}),
    },
    bodyTemplate: mode.value === 'custom' ? bodyTemplate.value : null,
    responsePath: responsePath.value,
    ...(secret.value.trim() === '' ? {} : { secret: secret.value }),
    ...(clearSecret.value ? { clearSecret: true } : {}),
  };
  emit('save', input);
}

function test(): void {
  localError.value = null;
  if (props.config === null || !props.config.configured || !props.config.enabled) {
    localError.value = '请先保存并启用 AI 配置。';
    return;
  }
  emit('test');
}
</script>

<template>
  <section class="theme-card card ai-settings">
    <div class="section-heading">
      <div>
        <h2>AI 助手</h2>
        <p class="hint">用自然语言生成待确认的记账草稿。API key 只保存在服务端。</p>
      </div>
    </div>

    <p v-if="!config?.encryptionKeyConfigured" class="notice notice-warning" role="status">
      服务器还没有配置 AI 加密密钥，保存 API key 前需要先设置 JIZHANG_AI_ENCRYPTION_KEY。
    </p>

    <label class="checkbox-row">
      <input v-model="enabled" type="checkbox" />
      <span>启用 AI 助手</span>
    </label>

    <div class="ai-grid">
      <label>
        <span>接口模式</span>
        <select v-model="mode" @change="onModeChange">
          <option value="chat-completions">OpenAI-compatible Chat Completions</option>
          <option value="responses">Responses</option>
          <option value="custom">自定义 HTTP JSON</option>
        </select>
      </label>

      <label>
        <span>配置名称</span>
        <input v-model="name" type="text" maxlength="80" placeholder="例如 DeepSeek 主账号" />
      </label>
    </div>

    <label>
      <span>请求地址</span>
      <input v-model="url" type="url" inputmode="url" autocomplete="off" placeholder="https://api.example.com/v1/chat/completions" />
    </label>

    <div class="ai-grid">
      <label>
        <span>请求方式</span>
        <select v-model="method" :disabled="mode !== 'custom'">
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
        </select>
      </label>

      <label>
        <span>模型名称</span>
        <input v-model="model" type="text" autocomplete="off" placeholder="例如 deepseek-chat" />
      </label>
    </div>

    <div class="ai-grid">
      <label>
        <span>认证方式</span>
        <select v-model="authKind">
          <option value="bearer">Bearer Token</option>
          <option value="header">自定义请求头</option>
          <option value="none">无认证</option>
        </select>
      </label>

      <label v-if="authKind === 'header'">
        <span>认证请求头名称</span>
        <input v-model="authHeaderName" type="text" autocomplete="off" placeholder="X-API-Key" />
      </label>
    </div>

    <label>
      <span>超时时间（毫秒）</span>
      <input v-model.number="timeoutMs" type="number" min="3000" max="60000" step="1000" />
    </label>

    <label>
      <span>API key / 密钥</span>
      <input v-model="secret" type="password" autocomplete="new-password" :placeholder="config?.hasSecret ? '已保存，留空表示保持不变' : '填写后仅发送到服务端'" />
    </label>
    <label v-if="config?.hasSecret" class="checkbox-row">
      <input v-model="clearSecret" type="checkbox" />
      <span>清除已保存的密钥</span>
    </label>

    <template v-if="mode === 'custom'">
      <label>
        <span>JSON 请求体模板</span>
        <textarea v-model="bodyTemplate" rows="7" spellcheck="false" placeholder='{"input":"{{input}}"}' />
        <small>可用变量：&#123;&#123;input&#125;&#125;、&#123;&#123;categories&#125;&#125;、&#123;&#123;accounts&#125;&#125;、&#123;&#123;model&#125;&#125;、&#123;&#123;today&#125;&#125;、&#123;&#123;responseSchema&#125;&#125;</small>
      </label>

      <label>
        <span>响应字段路径</span>
        <input v-model="responsePath" type="text" autocomplete="off" placeholder="choices[0].message.content" />
      </label>

      <label>
        <span>静态请求头（JSON）</span>
        <textarea v-model="headersText" rows="4" spellcheck="false" placeholder="{}" />
      </label>
    </template>

    <p v-else class="hint">常用模式会自动生成 JSON 请求和记账草稿提示词。</p>

    <p v-if="localError || error" class="error" role="alert">{{ localError || error }}</p>
    <p v-if="success" class="ok" role="status">{{ success }}</p>

    <div class="ai-actions">
      <button class="theme-button" type="button" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '保存 AI 配置' }}
      </button>
      <button class="theme-button ghost" type="button" :disabled="testing" @click="test">
        {{ testing ? '测试中…' : '测试连接' }}
      </button>
    </div>
    <p class="hint ai-warning">测试连接会发送一次最小请求，可能消耗 provider 配额。</p>
  </section>
</template>

<style>
.ai-settings{display:grid;gap:.75rem}.ai-settings label{display:grid;gap:.3rem;color:var(--muted);font-size:.85rem}.ai-settings input,.ai-settings select,.ai-settings textarea{width:100%;min-width:0;min-height:44px;padding:.55rem .65rem;font:inherit;font-size:16px;color:var(--fg);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-control);box-sizing:border-box}.ai-settings textarea{min-height:120px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}.ai-settings .ai-grid,.ai-settings .ai-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.ai-settings .checkbox-row{display:flex;align-items:center;gap:.55rem;min-height:44px;color:var(--fg)}.ai-settings .checkbox-row input{width:44px;min-width:44px;height:44px;min-height:44px;margin:0;accent-color:var(--accent)}.ai-settings .ai-actions{gap:.65rem}.ai-settings .error,.ai-settings .ok{margin:0}.ai-settings .error{color:var(--danger)}.ai-settings .ok{color:var(--ok)}

@media (max-width: 420px) {
  .ai-settings .ai-grid,
  .ai-settings .ai-actions {
    grid-template-columns: 1fr;
  }
}
</style>
