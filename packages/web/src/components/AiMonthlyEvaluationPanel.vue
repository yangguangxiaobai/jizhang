<script setup lang="ts">
/**
 * Keeps the on-demand AI explanation beside the server-owned monthly facts so that
 * generated prose can never replace the numbers the user is checking.
 */
import type { AiEvaluationStatement, AiMonthlyEvaluationResult } from '../api/client.js';
import { formatYuan } from '../utils/money.js';
import AiThinkingStatus from './AiThinkingStatus.vue';

const MONTHLY_EVALUATION_MESSAGES = [
  '我先核对本月收入和支出的统计口径…',
  '正在查看分类占比、趋势和预算周期…',
] as const;

withDefaults(
  defineProps<{
    result: AiMonthlyEvaluationResult | null;
    loading?: boolean;
    errorMessage?: string | null;
  }>(),
  { loading: false, errorMessage: null },
);

const emit = defineEmits<{ generate: [] }>();

function percentage(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function evidenceAttribute(statement: AiEvaluationStatement): string {
  return statement.evidenceIds.join(',');
}
</script>

<template>
  <section class="theme-card">
    <header class="ai-head">
      <div>
        <h2>本月 AI 评价</h2>
        <p class="ai-subtitle">只发送汇总数字，按需生成，不保存评价结果。</p>
      </div>
      <button
        type="button"
        class="theme-button ai-button"
        :disabled="loading"
        @click="emit('generate')"
      >
        {{ loading ? '生成中…' : '生成评价' }}
      </button>
    </header>

    <AiThinkingStatus
      :active="loading"
      title="AI 正在分析本月数据"
      :messages="MONTHLY_EVALUATION_MESSAGES"
    />

    <p v-if="errorMessage" class="notice notice-danger" role="alert">{{ errorMessage }}</p>

    <template v-if="result">
      <p
        class="notice notice-accent ai-summary"
        :data-evidence-ids="evidenceAttribute(result.evaluation.summary)"
      >
        {{ result.evaluation.summary.text }}
      </p>

      <dl class="ai-facts">
        <div>
          <dt>本月收入</dt>
          <dd>{{ formatYuan(result.facts.monthly.incomeCents) }}</dd>
        </div>
        <div>
          <dt>本月净支出</dt>
          <dd>{{ formatYuan(result.facts.monthly.netExpenseCents) }}</dd>
        </div>
      </dl>

      <div v-if="result.facts.categories.length > 0" class="ai-fact-group">
        <h3>支出分类</h3>
        <ul class="ai-fact-list">
          <li v-for="item in result.facts.categories.slice(0, 5)" :key="item.evidenceId">
            <span>{{ item.categoryName }}</span>
            <strong>{{ formatYuan(item.amountCents) }} · {{ percentage(item.ratio) }}</strong>
          </li>
        </ul>
      </div>

      <div v-if="result.facts.budget" class="ai-fact-group">
        <h3>当前预算周期</h3>
        <p class="ai-budget-note">
          {{ result.facts.budget.cycle.kind === 'natural-month' ? '自然月' : `每月 ${result.facts.budget.cycle.day} 日起` }}
          · 预算 {{ formatYuan(result.facts.budget.totalBudgetCents) }}
          · 已用 {{ formatYuan(result.facts.budget.totalSpentCents) }}
          · 结余池 {{ formatYuan(result.facts.budget.carryoverPoolCents) }}
        </p>
      </div>

      <div v-for="section in [
        { key: 'highlights', title: '亮点', items: result.evaluation.highlights },
        { key: 'risks', title: '风险提醒', items: result.evaluation.risks },
        { key: 'suggestions', title: '下一步建议', items: result.evaluation.suggestions },
      ]" :key="section.key" v-show="section.items.length > 0" class="ai-fact-group">
        <h3>{{ section.title }}</h3>
        <ul class="ai-list">
          <li
            v-for="item in section.items"
            :key="`${section.key}-${item.text}`"
            :data-evidence-ids="evidenceAttribute(item)"
          >
            {{ item.text }}
          </li>
        </ul>
      </div>
    </template>

    <p v-else-if="!errorMessage" class="ai-empty">
      点击“生成评价”后，AI 会基于当前自然月的汇总数据给出简短说明。
    </p>
  </section>
</template>
