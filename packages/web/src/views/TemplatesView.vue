<script setup lang="ts">
/**
 * Allocation templates: modules = category + ratio, ratios summing to 100%.
 *
 * The client validates the same rules the server enforces (sum within 1e-4, no
 * repeated category, positive ratios) so a mistake is caught before a round trip —
 * but the server remains authoritative.
 */
import { RATIO_SUM_TOLERANCE } from '@jizhang/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { TemplateModule } from '../api/client.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';

const budget = useBudgetStore();
const meta = useMetaStore();
const router = useRouter();

const editingId = ref<string | null>(null);
const draftName = ref('');
const draftModules = ref<TemplateModule[]>([]);
const saving = ref(false);
const localError = ref<string | null>(null);

const ratioSum = computed(() =>
  draftModules.value.reduce((total, module) => total + module.ratio, 0),
);
const ratioPercent = computed(() => Math.round(ratioSum.value * 100));
const sumIsValid = computed(
  () => Math.abs(ratioSum.value - 1) < RATIO_SUM_TOLERANCE,
);

onMounted(async () => {
  await Promise.all([budget.loadTemplates(), meta.load()]);
});

/** Only expense categories can receive an envelope (income is not budgeted). */
const budgetableCategories = computed(() => meta.expenseCategories);

function startCreate(): void {
  editingId.value = 'new';
  draftName.value = '';
  // Seed from the default template so a new one starts from a working ratio set.
  draftModules.value = (budget.defaultTemplate?.modules ?? []).map((module) => ({
    categoryId: module.categoryId,
    ratio: module.ratio,
  }));
  localError.value = null;
}

function startEdit(id: string): void {
  const template = budget.templates.find((t) => t.id === id);
  if (template === undefined) return;
  editingId.value = id;
  draftName.value = template.name;
  draftModules.value = template.modules.map((module) => ({ ...module }));
  localError.value = null;
}

function cancel(): void {
  editingId.value = null;
  localError.value = null;
}

function addModule(): void {
  const used = new Set(draftModules.value.map((module) => module.categoryId));
  const next = budgetableCategories.value.find((category) => !used.has(category.id));
  if (next === undefined) return;
  draftModules.value = [...draftModules.value, { categoryId: next.id, ratio: 0 }];
}

function removeModule(index: number): void {
  draftModules.value = draftModules.value.filter((_, i) => i !== index);
}

/**
 * Editing a ratio as a percentage keeps the stored value a fraction; the rounding
 * happens once, here, so the sum check still uses the real numbers.
 */
function setRatioPercent(index: number, percentText: string): void {
  const percent = Number(percentText);
  const ratio = Number.isFinite(percent) ? percent / 100 : 0;
  draftModules.value = draftModules.value.map((module, i) =>
    i === index ? { ...module, ratio } : module,
  );
}

/** Evenly re-splits 100% across the current module count, absorbing the remainder. */
function distributeEvenly(): void {
  const count = draftModules.value.length;
  if (count === 0) return;
  const base = Math.floor(10000 / count) / 10000;
  draftModules.value = draftModules.value.map((module, index) => ({
    ...module,
    // Last module takes the remainder so the sum is exactly 1.
    ratio: index === count - 1 ? Number((1 - base * (count - 1)).toFixed(4)) : base,
  }));
}

async function save(): Promise<void> {
  localError.value = null;

  if (draftName.value.trim() === '') {
    localError.value = '请输入模板名称。';
    return;
  }
  if (draftModules.value.length === 0) {
    localError.value = '至少需要一个模块。';
    return;
  }
  const ids = draftModules.value.map((module) => module.categoryId);
  if (new Set(ids).size !== ids.length) {
    localError.value = '同一个分类不能重复出现。';
    return;
  }
  if (draftModules.value.some((module) => !(module.ratio > 0))) {
    localError.value = '每个模块的比例都必须大于 0。';
    return;
  }
  if (!sumIsValid.value) {
    localError.value = `各模块比例之和必须为 100%（当前 ${ratioPercent.value}%）。`;
    return;
  }

  saving.value = true;
  try {
    const ok =
      editingId.value === 'new'
        ? await budget.createTemplate(draftName.value.trim(), draftModules.value)
        : editingId.value !== null
          ? await budget.updateTemplate(editingId.value, {
              name: draftName.value.trim(),
              modules: draftModules.value,
            })
          : false;

    if (ok) {
      editingId.value = null;
    } else {
      localError.value = budget.errorMessage ?? '保存失败。';
    }
  } finally {
    saving.value = false;
  }
}

async function remove(id: string, name: string): Promise<void> {
  if (!window.confirm(`删除模板「${name}」？`)) return;
  const ok = await budget.deleteTemplate(id);
  if (!ok) localError.value = budget.errorMessage;
}

function categoryOptions(currentId: string): { id: string; name: string }[] {
  const used = new Set(
    draftModules.value
      .map((module) => module.categoryId)
      .filter((id) => id !== currentId),
  );
  return budgetableCategories.value.filter((category) => !used.has(category.id));
}
</script>

<template>
  <p v-if="budget.loading && budget.templates.length === 0" class="muted">加载中…</p>

  <template v-else>
    <!-- Editor -->
    <section v-if="editingId !== null" class="editor card">
      <h2>{{ editingId === 'new' ? '新建模板' : '编辑模板' }}</h2>

      <label class="field">
        <span>模板名称</span>
        <input v-model="draftName" type="text" maxlength="40" placeholder="例如：月薪分配" />
      </label>

      <ul class="modules">
        <li v-for="(module, index) in draftModules" :key="module.categoryId">
          <select
            :value="module.categoryId"
            :aria-label="`第 ${index + 1} 个模块的分类`"
            @change="
              (event) => {
                const value = (event.target as HTMLSelectElement).value;
                draftModules = draftModules.map((m, i) =>
                  i === index ? { ...m, categoryId: value } : m,
                );
              }
            "
          >
            <option v-for="c in categoryOptions(module.categoryId)" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>

          <input
            :value="Math.round(module.ratio * 10000) / 100"
            inputmode="decimal"
            :aria-label="`第 ${index + 1} 个模块的比例`"
            @input="setRatioPercent(index, ($event.target as HTMLInputElement).value)"
          />
          <span class="unit">%</span>

          <button
            type="button"
            class="icon"
            :aria-label="`移除第 ${index + 1} 个模块`"
            @click="removeModule(index)"
          >
            ✕
          </button>
        </li>
      </ul>

      <div class="editor-actions">
        <button type="button" class="ghost" @click="addModule">添加模块</button>
        <button type="button" class="ghost" @click="distributeEvenly">平均分配</button>
      </div>

      <p class="sum" :class="{ ok: sumIsValid, bad: !sumIsValid }">
        合计 {{ ratioPercent }}%
        <template v-if="!sumIsValid">（必须为 100%）</template>
        <template v-else>✓</template>
      </p>

      <p v-if="localError" class="error" role="alert">{{ localError }}</p>

      <div class="editor-actions">
        <button type="button" class="primary" :disabled="saving || !sumIsValid" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button type="button" class="ghost" :disabled="saving" @click="cancel">取消</button>
      </div>
    </section>

    <!-- List -->
    <ul v-else class="templates">
      <li v-for="template in budget.templates" :key="template.id">
        <div class="head">
          <span class="name">
            {{ template.name }}
            <span v-if="template.isDefault" class="badge">默认</span>
          </span>
          <span class="count">{{ template.modules.length }} 个模块</span>
        </div>

        <ul class="ratios">
          <li v-for="module in template.modules" :key="module.categoryId">
            <span>{{ meta.categoryName(module.categoryId) }}</span>
            <span>{{ Math.round(module.ratio * 10000) / 100 }}%</span>
          </li>
        </ul>

        <div class="row-actions">
          <button type="button" @click="startEdit(template.id)">编辑</button>
          <button
            type="button"
            :disabled="template.isDefault"
            @click="budget.setDefaultTemplate(template.id)"
          >
            {{ template.isDefault ? '已是默认' : '设为默认' }}
          </button>
          <button
            type="button"
            class="danger"
            :disabled="template.isDefault"
            @click="remove(template.id, template.name)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>

    <p v-if="localError && editingId === null" class="error" role="alert">{{ localError }}</p>

    <div v-if="editingId === null" class="actions">
      <button type="button" class="primary" @click="startCreate">新建模板</button>
      <button type="button" class="ghost" @click="router.push({ name: 'budget' })">
        返回预算
      </button>
    </div>
  </template>
</template>

<style scoped>
.card {
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.field {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.85rem;
  font-size: 0.85rem;
  color: var(--muted);
}

input,
select {
  font-size: 16px;
  min-height: 44px;
  padding: 0.45rem 0.6rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

.modules {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.modules li {
  display: grid;
  grid-template-columns: 1fr 5rem 1rem 44px;
  align-items: center;
  gap: 0.4rem;
}

.modules input {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.unit {
  font-size: 0.85rem;
  color: var(--muted);
}

.icon {
  width: 44px;
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  cursor: pointer;
}

.icon:hover {
  color: var(--danger);
}

.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.editor-actions button {
  min-height: 44px;
  padding: 0 0.9rem;
  font: inherit;
  border-radius: 0.5rem;
  cursor: pointer;
}

.editor-actions .primary {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
  font-weight: 600;
}

.editor-actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.editor-actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sum {
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.sum.ok {
  color: var(--ok);
}

.sum.bad {
  color: var(--danger);
}

.templates {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  gap: 0.65rem;
}

.templates > li {
  padding: 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.name {
  font-size: 0.98rem;
}

.badge {
  margin-left: 0.35rem;
  padding: 0.05rem 0.35rem;
  font-size: 0.7rem;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0.35rem;
}

.count {
  font-size: 0.75rem;
  color: var(--muted);
}

.ratios {
  list-style: none;
  margin: 0 0 0.65rem;
  padding: 0;
  display: grid;
  gap: 0.2rem;
}

.ratios li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.82rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.row-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
}

.row-actions button {
  min-height: 44px;
  font: inherit;
  font-size: 0.85rem;
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.row-actions .danger {
  color: var(--danger);
}

.row-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.55rem;
  cursor: pointer;
}

.actions .primary {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.error {
  margin: 0 0 0.6rem;
  color: var(--danger);
  font-size: 0.85rem;
}

.muted {
  color: var(--muted);
}
</style>
