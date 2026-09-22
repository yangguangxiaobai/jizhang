<script setup lang="ts">
/**
 * Dedicated AI provider settings page.
 *
 * The provider form is intentionally separated from the general settings page because it
 * contains a long custom-template form and a sensitive write-only API key field.
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  api,
  type AiProviderConfigInput,
  type AiProviderConfigSummary,
} from '../api/client.js';
import AiSettingsPanel from '../components/AiSettingsPanel.vue';

const router = useRouter();
const aiConfig = ref<AiProviderConfigSummary | null>(null);
const aiLoading = ref(true);
const aiSaving = ref(false);
const aiTesting = ref(false);
const aiError = ref<string | null>(null);
const aiSuccess = ref<string | null>(null);

onMounted(async () => {
  try {
    aiConfig.value = await api.ai.config();
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error);
  } finally {
    aiLoading.value = false;
  }
});

async function saveAi(input: AiProviderConfigInput): Promise<void> {
  aiSaving.value = true;
  aiError.value = null;
  aiSuccess.value = null;
  try {
    aiConfig.value = await api.ai.saveConfig(input);
    aiSuccess.value = 'AI 配置已保存。';
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error);
  } finally {
    aiSaving.value = false;
  }
}

async function testAi(): Promise<void> {
  aiTesting.value = true;
  aiError.value = null;
  aiSuccess.value = null;
  try {
    await api.ai.test();
    aiSuccess.value = 'AI provider 连接测试成功。';
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : String(error);
  } finally {
    aiTesting.value = false;
  }
}
</script>

<template>
  <div class="ai-page">
    <button class="theme-button ghost back-button" type="button" @click="router.push({ name: 'settings' })">
      返回「我的」
    </button>

    <p v-if="aiLoading" class="hint">正在加载 AI 配置…</p>
    <AiSettingsPanel
      v-else
      :config="aiConfig"
      :saving="aiSaving"
      :testing="aiTesting"
      :error="aiError"
      :success="aiSuccess"
      @save="saveAi"
      @test="testAi"
    />

    <section class="theme-card">
      <h2>AI 数据整理</h2>
      <p>扫描重复分类和标签，先预览影响，再逐项确认并支持条件撤销。</p>
      <button class="theme-button" type="button" @click="router.push({ name: 'ai-organization' })">
        打开数据整理
      </button>
    </section>

    <section class="theme-card card security-note">
      <h2>密钥安全说明</h2>
      <ul>
        <li>API key 通过 HTTPS 发送到本站服务端，不会返回给浏览器。</li>
        <li>服务器会使用独立的加密密钥加密后保存，数据库备份中不是可直接使用的明文 key。</li>
        <li>拥有服务器 root 权限、`.env` 或运行进程访问权的人仍可能取得 key；请使用可撤销、有限额的 provider key。</li>
        <li>不要把 API key 写进请求模板、静态请求头、截图或账单备注。</li>
      </ul>
    </section>
  </div>
</template>

<style>
.ai-page{display:grid;gap:.75rem}
</style>
