<script setup lang="ts">
/** Shares the per-row import review between the manual import modal and assistant cards. */
import { computed } from 'vue';
import { TYPE_INCOME, type Category, type PlatformImportRow } from '../api/client.js';
import { formatCents } from '../utils/money.js';

const props = defineProps<{
  rows: readonly PlatformImportRow[];
  categories: readonly Category[];
  selectedIds: ReadonlySet<string> | readonly string[];
  categoryOverrides: Readonly<Record<string, string>>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [rowId: string];
  categoryChange: [change: { row: PlatformImportRow; categoryName: string }];
}>();

const candidates = computed(() =>
  props.rows.filter((row) => !row.ignored && !row.alreadyExists && row.amountCents > 0),
);
const ignoredRows = computed(() => props.rows.filter((row) => row.ignored || row.alreadyExists));
const selected = computed(() => new Set(props.selectedIds));

function categoriesFor(type: number): readonly Category[] {
  return props.categories.filter((category) => category.type === type);
}

function categoryFor(row: PlatformImportRow): string {
  return props.categoryOverrides[row.id] ?? row.categoryName;
}

function changeCategory(row: PlatformImportRow, event: Event): void {
  emit('categoryChange', {
    row,
    categoryName: (event.target as HTMLSelectElement).value,
  });
}
</script>

<template>
  <div class="import-rows">
    <p v-if="candidates.length === 0" class="empty">没有可导入的明细（可能都被过滤或已存在）。</p>
    <article v-for="row in candidates" :key="row.id" class="import-row">
      <label class="row-heading">
        <input
          type="checkbox"
          :checked="selected.has(row.id)"
          :disabled="disabled"
          :aria-label="`选择 ${row.dateLabel} ${row.note}`"
          @change="emit('toggle', row.id)"
        />
        <span><strong>{{ row.dateLabel }}</strong> · {{ row.note || row.counterparty || '未填写备注' }}</span>
      </label>
      <p class="row-source">
        {{ row.counterparty }}<span v-if="row.sourceCategory"> · {{ row.sourceCategory }}</span>
        <span v-if="categoryFor(row) !== row.categoryName"> · 建议「{{ row.categoryName }}」→「{{ categoryFor(row) }}」</span>
      </p>
      <p v-if="row.possibleDuplicate" class="row-warning">
        可能重复{{ row.duplicateOfNote ? `（已有备注：${row.duplicateOfNote}）` : '' }}，默认未选
      </p>
      <div class="row-edit">
        <strong :class="row.type === TYPE_INCOME ? 'income' : 'expense'">
          {{ row.type === TYPE_INCOME ? '+' : '−' }}{{ formatCents(row.amountCents) }}
        </strong>
        <select
          :value="categoryFor(row)"
          :disabled="disabled"
          :aria-label="`分类 ${row.note}`"
          @change="changeCategory(row, $event)"
        >
          <option
            v-if="!categoriesFor(row.type).some((category) => category.name === categoryFor(row))"
            :value="categoryFor(row)"
          >
            {{ categoryFor(row) || '保持原分类' }}
          </option>
          <option v-for="category in categoriesFor(row.type)" :key="category.id" :value="category.name">
            {{ category.name }}
          </option>
        </select>
      </div>
    </article>
    <details v-if="ignoredRows.length" class="ignored-rows">
      <summary>已过滤 / 已存在（{{ ignoredRows.length }}）</summary>
      <ul>
        <li v-for="row in ignoredRows" :key="row.id">
          {{ row.dateLabel }} · {{ row.note || row.counterparty }} · {{ formatCents(row.amountCents) }} —
          {{ row.alreadyExists ? '账本中已存在' : row.ignoreReason || '已过滤' }}
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.import-rows{display:grid;gap:.5rem;min-width:0}.import-row{display:grid;gap:.25rem;padding:.55rem;border:1px solid var(--border);border-radius:.55rem;background:var(--surface)}.row-heading{display:flex;align-items:center;gap:.45rem;min-width:0}.row-heading input{width:44px;height:44px;flex:0 0 44px}.row-heading span{overflow-wrap:anywhere}.row-source,.row-warning{margin:0 0 0 2.8rem;font-size:.78rem;color:var(--muted);overflow-wrap:anywhere}.row-warning{color:var(--warning)}.row-edit{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-left:2.8rem}.row-edit strong{font-variant-numeric:tabular-nums;white-space:nowrap}.row-edit .income{color:var(--ok)}.row-edit .expense{color:var(--danger)}.row-edit select{min-width:0;max-width:60%;min-height:44px;font-size:16px;color:var(--fg);background:var(--bg);border:1px solid var(--border);border-radius:.4rem}.empty,.ignored-rows ul{margin:.25rem 0;color:var(--muted)}.ignored-rows summary{display:flex;align-items:center;min-height:44px;font-weight:600}.ignored-rows li{font-size:.78rem;line-height:1.5;overflow-wrap:anywhere}
</style>
