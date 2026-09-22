<script setup lang="ts">
/**
 * Explicit preview/apply/undo surface for AI-assisted data organization.
 * The page never scans on mount and never treats an AI explanation as permission to write.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type AiOrganizationAction, type AiOrganizationOperationResult, type AiOrganizationPreview } from '../api/client.js';
import AiThinkingStatus from '../components/AiThinkingStatus.vue';

const router = useRouter();
const preview = ref<AiOrganizationPreview | null>(null);
const selected = ref<string[]>([]);
const operation = ref<AiOrganizationOperationResult | null>(null);
const loading = ref(false);
const applying = ref(false);
const undoing = ref(false);
const errorMessage = ref<string | null>(null);

const SCAN_MESSAGES = [
  '我先读取最近的账单和现有分类…',
  '正在把备注和标签整理成可分析的摘要…',
  '我会检查哪些账单适合已有分类，以及是否需要新分类…',
] as const;
const APPLY_MESSAGES = [
  '正在再次核对预览版本，防止覆盖刚发生的修改…',
  '正在按选择逐项整理关联数据…',
  '正在写入审计记录，稍后可以条件撤销…',
] as const;
const UNDO_MESSAGES = [
  '正在检查整理后的数据有没有被再次修改…',
  '正在恢复原来的分类和标签引用…',
  '正在记录撤销结果…',
] as const;

const progressMessages = computed(() =>
  applying.value ? APPLY_MESSAGES : undoing.value ? UNDO_MESSAGES : SCAN_MESSAGES,
);
const progressTitle = computed(() =>
  applying.value ? 'AI 正在应用整理' : undoing.value ? 'AI 正在撤销整理' : 'AI 正在分析数据',
);

const readyActions = computed(() =>
  (preview.value?.actions ?? []).filter((action) => action.status === 'ready'),
);

function isSelected(actionId: string): boolean {
  return selected.value.includes(actionId);
}

function toggle(action: AiOrganizationAction): void {
  if (action.status !== 'ready') return;
  selected.value = isSelected(action.actionId)
    ? selected.value.filter((id) => id !== action.actionId)
    : [...selected.value, action.actionId];
}

async function scan(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  operation.value = null;
  try {
    preview.value = await api.ai.organizationPreview();
    selected.value = preview.value.actions
      .filter((action) => action.status === 'ready')
      .map((action) => action.actionId);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

async function apply(): Promise<void> {
  if (preview.value === null || selected.value.length === 0) return;
  if (!window.confirm(`确认应用 ${selected.value.length} 项整理？这会修改账单分类/标签及相关配置。`)) return;
  applying.value = true;
  errorMessage.value = null;
  try {
    operation.value = await api.ai.organizationApply({
      previewHash: preview.value.previewHash,
      actionIds: selected.value,
    });
    selected.value = [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    applying.value = false;
  }
}

async function undo(): Promise<void> {
  if (operation.value === null || operation.value.status !== 'applied') return;
  if (!window.confirm('确认撤销这次整理？如果相关数据已被手动修改，服务端会拒绝撤销。')) return;
  undoing.value = true;
  errorMessage.value = null;
  try {
    operation.value = await api.ai.organizationUndo(operation.value.operationId);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    undoing.value = false;
  }
}
</script>

<template>
  <section class="theme-card">
    <button class="theme-button ghost" type="button" @click="router.push({ name: 'ai-settings' })">
      返回 AI 助手
    </button>
    <h1>AI 数据整理</h1>
    <p>先扫描预览，再逐项确认。服务端会检查分类依赖、预算快照和周期账单，AI 不会直接修改数据。</p>
    <button class="theme-button" type="button" :disabled="loading || applying || undoing" @click="scan">
      {{ loading ? '扫描中…' : '扫描整理建议' }}
    </button>
    <AiThinkingStatus
      :active="loading || applying || undoing"
      :title="progressTitle"
      :messages="progressMessages"
    />
  </section>

  <p v-if="errorMessage" class="notice notice-danger" role="alert">{{ errorMessage }}</p>

  <section v-if="preview" class="theme-card">
    <h2>整理预览</h2>
    <p>
      发现 {{ preview.actions.length }} 项整理（可执行 {{ readyActions.length }} 项）、{{ preview.recommendations.length }} 项语义建议；
      本次分析最近 {{ preview.scope.sampledTransactions }} / {{ preview.scope.totalTransactions }} 笔账单。
      未点击确认前不会写入。
    </p>
    <p v-if="preview.semanticAvailable">
      AI 使用了截断后的备注摘要和标签，不包含金额、账户和日期；语义建议仍需手动处理。
    </p>
    <p v-else>AI provider 未配置或暂时不可用，当前只显示确定性的重复整理结果。</p>

    <section v-if="preview.recommendations.length > 0" class="theme-card">
      <h3>AI 分类建议</h3>
      <ul>
        <li v-for="recommendation in preview.recommendations" :key="recommendation.recommendationId">
          <strong v-if="recommendation.kind === 'transaction-reclassify'">
            账单「{{ recommendation.notePreview || '无备注账单' }}」：
            {{ recommendation.sourceCategoryName }} → {{ recommendation.targetCategoryName }}
          </strong>
          <strong v-else>
            建议新增分类「{{ recommendation.proposedCategoryName }}」
          </strong>
          <p>{{ recommendation.reason }}</p>
          <p>这是建议，不会自动创建分类或修改账单；请在分类/账单页面手动确认。</p>
        </li>
      </ul>
    </section>

    <ul>
      <li v-for="action in preview.actions" :key="action.actionId">
        <button
          class="theme-button"
          type="button"
          :disabled="action.status !== 'ready'"
          :aria-pressed="isSelected(action.actionId)"
          @click="toggle(action)"
        >
          {{ isSelected(action.actionId) ? '已选' : '选择' }}
        </button>
        <strong>
          {{ action.kind === 'category-merge' ? '分类合并' : '标签合并' }}：
          {{ action.sourceName }} → {{ action.targetName }}
        </strong>
        <p>{{ action.reason }}</p>
        <p>影响账单 {{ action.affected.transactions }} 笔，预算快照 {{ action.affected.budgetAllocations }} 条，模板 {{ action.affected.templates }} 个，周期规则 {{ action.affected.recurringRules }} 条。</p>
        <p v-if="action.blockers.length > 0" role="alert">阻塞：{{ action.blockers.join('；') }}</p>
      </li>
    </ul>

    <button class="theme-button" type="button" :disabled="applying || selected.length === 0" @click="apply">
      {{ applying ? '应用中…' : `确认应用已选 ${selected.length} 项` }}
    </button>
  </section>

  <section v-if="operation" class="theme-card" role="status">
    <h2>{{ operation.status === 'applied' ? '整理已应用' : '整理已撤销' }}</h2>
    <p>操作编号：{{ operation.operationId }}</p>
    <button v-if="operation.status === 'applied'" class="theme-button" type="button" :disabled="undoing" @click="undo">
      {{ undoing ? '撤销中…' : '撤销这次整理' }}
    </button>
  </section>
</template>
