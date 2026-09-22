<script setup lang="ts">
/**
 * Natural-language entry surface for a new transaction.
 *
 * It only emits the user's text and renders the server's draft status. The parent form
 * remains responsible for applying editable values and for the final ledger save.
 */
import { ref } from 'vue';
import type { AiTransactionDraft } from '../api/client.js';
import AiThinkingStatus from './AiThinkingStatus.vue';

defineProps<{
  busy: boolean;
  error: string | null;
  draft: AiTransactionDraft | null;
}>();

const emit = defineEmits<{
  submit: [input: string];
}>();

const input = ref('');

const AI_DRAFT_MESSAGES = [
  '我先识别金额、日期和支付账户…',
  '正在匹配你已有的分类，不会新建分类…',
] as const;

const missingLabels: Record<string, string> = {
  amount: '金额',
  type: '类型',
  category: '分类',
  account: '账户',
  date: '日期',
};

function requestDraft(): void {
  const value = input.value.trim();
  if (value === '') return;
  emit('submit', value);
}
</script>

<template>
  <section class="ai-draft-panel" aria-labelledby="ai-draft-title">
    <div class="panel-heading">
      <div>
        <h2 id="ai-draft-title">AI 快速记账</h2>
        <p>例如：昨天午饭 35 元，微信支付。AI 只填入草稿，不会直接保存。</p>
      </div>
    </div>

    <textarea
      v-model="input"
      rows="2"
      maxlength="2000"
      placeholder="说说这笔钱是什么…"
      aria-label="自然语言记账描述"
      @keydown.meta.enter.prevent="requestDraft"
      @keydown.ctrl.enter.prevent="requestDraft"
    />
    <button class="ai-submit" type="button" :disabled="busy || input.trim() === ''" @click="requestDraft">
      {{ busy ? '识别中…' : 'AI 识别' }}
    </button>

    <AiThinkingStatus :active="busy" title="AI 正在整理这笔账" :messages="AI_DRAFT_MESSAGES" />

    <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
    <p v-else-if="draft" class="ai-success" role="status">
      已将能识别的内容填入下方表单，请检查后再保存。
      <template v-if="draft.missing.length > 0">
        还需要确认：{{ draft.missing.map((field) => missingLabels[field] ?? field).join('、') }}。
      </template>
    </p>
  </section>
</template>

<style>
.ai-draft-panel{display:grid;gap:.65rem;padding:.85rem;background:var(--surface-soft);border:1px solid var(--border);border-radius:var(--radius-card)}.ai-draft-panel textarea{width:100%;min-height:72px;padding:.65rem;font:inherit;font-size:16px;line-height:1.5;color:var(--fg);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-control);box-sizing:border-box;resize:vertical}.ai-draft-panel .ai-submit{min-height:44px;padding:0 1rem;font:inherit;font-weight:650;color:var(--on-accent);background:var(--accent);border:0;border-radius:var(--radius-control)}.ai-draft-panel .ai-submit:disabled{opacity:.55;cursor:progress}.ai-draft-panel .ai-error,.ai-draft-panel .ai-success{margin:0;font-size:.82rem;line-height:1.5}.ai-draft-panel .ai-error{color:var(--danger)}.ai-draft-panel .ai-success{color:var(--ok)}
</style>
