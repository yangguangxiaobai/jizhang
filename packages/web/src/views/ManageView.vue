<script setup lang="ts">
/**
 * Master-data management: categories, accounts and tags.
 *
 * Notes on the rules this UI reflects (T7 PRD):
 *   * seeded rows are marked 内建 and cannot be deleted, but CAN be renamed — the
 *     preset name is a starting point, not a lock;
 *   * deleting is a soft delete, so a category that historical transactions use
 *     keeps rendering its name. The delete confirmation says how many transactions
 *     reference it, instead of that being a surprise;
 *   * tags have no table (the name is the identity), so renaming or deleting a tag
 *     rewrites every referencing transaction on the server.
 */
import { CATEGORY_PALETTE, paletteSlot } from '@jizhang/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import type { Account, Category, TagCount } from '../api/client.js';
import { useBalanceStore } from '../stores/balances.js';
import { useBudgetStore } from '../stores/budget.js';
import { useMetaStore } from '../stores/meta.js';
import { categoryCssColor } from '../utils/category-color.js';
import { formatCents, formatYuan, parseYuanToCents } from '../utils/money.js';

type Tab = 'categories' | 'accounts' | 'tags';

const meta = useMetaStore();
const budget = useBudgetStore();
const balances = useBalanceStore();
const router = useRouter();

const tab = ref<Tab>('categories');
const busy = ref(false);
const errorMessage = ref<string | null>(null);

// ── category editor ──────────────────────────────────────────────────────────
const categoryDraft = ref<{
  id: string | null;
  name: string;
  type: number;
  icon: string;
  color: number;
} | null>(null);

/**
 * The picker offers the shared palette, and nothing else: `color` is stored as the slot's
 * ARGB integer, which is what lets the charts render it as a theme-aware token. The swatch
 * itself is drawn with the token too, so the picker shows the colour the category will have
 * in the theme the user is looking at, and each button is named ("颜色：蓝") rather than
 * announced as a hex string.
 */
const PALETTE = CATEGORY_PALETTE;

/** A new category starts in the "other" slot, like the seeded 其他. */
const DEFAULT_COLOR = paletteSlot(6).argb;

/** Semantic icon names the seed data uses; the UI shows a matching emoji. */
const ICONS: { id: string; glyph: string; label: string }[] = [
  { id: 'food', glyph: '🍚', label: '餐饮' },
  { id: 'transport', glyph: '🚌', label: '交通' },
  { id: 'housing', glyph: '🏠', label: '住房' },
  { id: 'shopping', glyph: '🛍️', label: '购物' },
  { id: 'entertainment', glyph: '🎬', label: '娱乐' },
  { id: 'salary', glyph: '💰', label: '工资' },
  { id: 'medical', glyph: '💊', label: '医疗' },
  { id: 'education', glyph: '📚', label: '教育' },
  { id: 'pet', glyph: '🐾', label: '宠物' },
  { id: 'other', glyph: '📦', label: '其他' },
];

function iconGlyph(id: string): string {
  return ICONS.find((i) => i.id === id)?.glyph ?? '📦';
}

/**
 * Whether a draft holds a given swatch. Both sides are forced unsigned: a colour that
 * arrived from the API as the signed form of the same integer must still light up.
 */
function isChosen(color: number, swatch: number): boolean {
  return color >>> 0 === swatch >>> 0;
}

const expenseCategories = computed(() =>
  meta.categories.filter((c) => c.type === 0),
);
const incomeCategories = computed(() =>
  meta.categories.filter((c) => c.type === 1),
);

onMounted(async () => {
  await Promise.all([meta.load(true), balances.load(true)]);
});

/** The account's balance in cents, or `null` while the balance load has not landed. */
function accountBalanceCents(account: Account): number | null {
  return balances.balanceOf(account.id) ?? null;
}

/** `—` rather than `¥0.00` while unknown: an unloaded figure is not a zero. */
function accountBalanceText(account: Account): string {
  const cents = accountBalanceCents(account);
  return cents === null ? '—' : formatYuan(cents);
}

/** Opens the ledger filtered to one account. Reuses the existing `transactions` route. */
function openAccountLedger(account: Account): void {
  void router.push({ name: 'transactions', query: { accountId: account.id } });
}

function startCategoryCreate(type: number): void {
  categoryDraft.value = {
    id: null,
    name: '',
    type,
    icon: 'other',
    color: DEFAULT_COLOR,
  };
  errorMessage.value = null;
}

function startCategoryEdit(category: Category): void {
  categoryDraft.value = {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color >>> 0,
  };
  errorMessage.value = null;
}

async function saveCategory(): Promise<void> {
  const draft = categoryDraft.value;
  if (draft === null) return;
  if (draft.name.trim() === '') {
    errorMessage.value = '请输入分类名称。';
    return;
  }

  busy.value = true;
  errorMessage.value = null;
  try {
    if (draft.id === null) {
      await api.categories.create({
        name: draft.name.trim(),
        type: draft.type,
        icon: draft.icon,
        color: draft.color,
      });
    } else {
      await api.categories.update(draft.id, {
        name: draft.name.trim(),
        icon: draft.icon,
        color: draft.color,
      });
    }
    categoryDraft.value = null;
    await meta.load(true);
    await budget.loadOverview();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function deleteCategory(category: Category): Promise<void> {
  busy.value = true;
  errorMessage.value = null;
  try {
    // Tell the user what depends on it before they commit.
    const usage = await api.categories.usage(category.id);
    const warning =
      usage.transactions > 0
        ? `\n有 ${usage.transactions} 笔账单使用该分类，删除后历史账单仍会显示名称，但不能再选择它。`
        : '';
    if (!window.confirm(`删除分类「${category.name}」？${warning}`)) return;

    await api.categories.remove(category.id);
    await meta.load(true);
    await budget.loadOverview();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  busy.value = true;
  try {
    await api.categories.move(id, dir);
    await meta.load(true);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

// ── account editor ───────────────────────────────────────────────────────────
const ACCOUNT_TYPES = ['现金', '储蓄卡', '信用卡', '支付宝', '微信', '其他'];

const accountDraft = ref<{
  id: string | null;
  name: string;
  type: number;
  balanceText: string;
} | null>(null);

function startAccountCreate(): void {
  accountDraft.value = { id: null, name: '', type: 0, balanceText: '' };
  errorMessage.value = null;
}

function startAccountEdit(account: Account): void {
  accountDraft.value = {
    id: account.id,
    name: account.name,
    type: account.type,
    balanceText: formatCents(account.initialBalanceCents),
  };
  errorMessage.value = null;
}

/** Accepts a negative balance (a credit card starts in debt). */
function parseBalance(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const negative = trimmed.startsWith('-');
  const positive = parseYuanToCents(negative ? trimmed.slice(1) : trimmed);
  if (positive === null) return null;
  return negative ? -positive : positive;
}

async function saveAccount(): Promise<void> {
  const draft = accountDraft.value;
  if (draft === null) return;
  if (draft.name.trim() === '') {
    errorMessage.value = '请输入账户名称。';
    return;
  }
  const balance = parseBalance(draft.balanceText);
  if (balance === null) {
    errorMessage.value = '初始余额格式不正确。';
    return;
  }

  busy.value = true;
  errorMessage.value = null;
  try {
    if (draft.id === null) {
      await api.accounts.create({
        name: draft.name.trim(),
        type: draft.type,
        initialBalanceCents: balance,
      });
    } else {
      await api.accounts.update(draft.id, {
        name: draft.name.trim(),
        type: draft.type,
        initialBalanceCents: balance,
      });
    }
    accountDraft.value = null;
    await Promise.all([meta.load(true), balances.load(true)]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function deleteAccount(account: Account): Promise<void> {
  busy.value = true;
  errorMessage.value = null;
  try {
    const usage = await api.accounts.usage(account.id);
    const rows = usage.transactions > 0 ? `\n有 ${usage.transactions} 笔账单属于该账户。` : '';
    // Deleting an account takes its balance out of the total (a soft-deleted account is
    // absent from the balance sheet). Say the amount, or the drop is a surprise.
    const cents = balances.balanceOf(account.id);
    const leaving =
      cents === undefined || cents === 0
        ? ''
        : `\n它的余额 ${formatYuan(cents)} 将从总余额中移除（历史账单保留）。`;
    if (!window.confirm(`删除账户「${account.name}」？${rows}${leaving}`)) return;

    await api.accounts.remove(account.id);
    await Promise.all([meta.load(true), balances.load(true)]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function moveAccount(id: string, dir: -1 | 1): Promise<void> {
  busy.value = true;
  try {
    await api.accounts.move(id, dir);
    await Promise.all([meta.load(true), balances.load(true)]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

// ── tags ─────────────────────────────────────────────────────────────────────
const tagRenameFrom = ref<string | null>(null);
const tagRenameTo = ref('');

function startTagRename(tag: TagCount): void {
  tagRenameFrom.value = tag.name;
  tagRenameTo.value = tag.name;
  errorMessage.value = null;
}

async function saveTagRename(): Promise<void> {
  const from = tagRenameFrom.value;
  if (from === null) return;
  const to = tagRenameTo.value.trim();
  if (to === '') {
    errorMessage.value = '请输入新的标签名。';
    return;
  }

  busy.value = true;
  errorMessage.value = null;
  try {
    await api.tagsAdmin.rename(from, to);
    tagRenameFrom.value = null;
    await Promise.all([meta.refreshTags(), budget.loadOverview()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function deleteTag(tag: TagCount): Promise<void> {
  busy.value = true;
  errorMessage.value = null;
  try {
    if (
      !window.confirm(
        `删除标签「${tag.name}」？\n有 ${tag.count} 笔账单使用它，删除后这些账单上不再显示该标签。`,
      )
    ) {
      return;
    }
    await api.tagsAdmin.remove(tag.name);
    await Promise.all([meta.refreshTags(), budget.loadOverview()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <nav class="tabs" aria-label="管理分类">
    <button
      v-for="item in [
        { id: 'categories' as Tab, label: '分类' },
        { id: 'accounts' as Tab, label: '账户' },
        { id: 'tags' as Tab, label: '标签' },
      ]"
      :key="item.id"
      type="button"
      :class="{ active: tab === item.id }"
      :aria-pressed="tab === item.id"
      @click="tab = item.id"
    >
      {{ item.label }}
    </button>
  </nav>

  <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

  <!-- ── categories ─────────────────────────────────────────────────────── -->
  <template v-if="tab === 'categories'">
    <section v-if="categoryDraft" class="editor card">
      <h2>{{ categoryDraft.id === null ? '新建分类' : '编辑分类' }}</h2>

      <label class="field">
        <span>名称</span>
        <input v-model="categoryDraft.name" type="text" maxlength="40" placeholder="例如：宠物" />
      </label>

      <fieldset class="field">
        <legend>图标</legend>
        <div class="icon-grid">
          <button
            v-for="icon in ICONS"
            :key="icon.id"
            type="button"
            class="icon"
            :class="{ active: categoryDraft.icon === icon.id }"
            :aria-label="icon.label"
            :aria-pressed="categoryDraft.icon === icon.id"
            @click="categoryDraft.icon = icon.id"
          >
            {{ icon.glyph }}
          </button>
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>颜色</legend>
        <div class="color-grid">
          <button
            v-for="entry in PALETTE"
            :key="entry.slot"
            type="button"
            class="swatch"
            :class="{ active: isChosen(categoryDraft.color, entry.argb) }"
            :style="{ background: `var(--cat-${entry.slot})` }"
            :aria-label="`颜色：${entry.name}`"
            :aria-pressed="isChosen(categoryDraft.color, entry.argb)"
            @click="categoryDraft.color = entry.argb"
          />
        </div>
      </fieldset>

      <div class="editor-actions">
        <button type="button" class="primary" :disabled="busy" @click="saveCategory">保存</button>
        <button type="button" class="ghost" @click="categoryDraft = null">取消</button>
      </div>
    </section>

    <template v-else>
      <section v-for="group in [
        { type: 0, label: '支出分类', items: expenseCategories },
        { type: 1, label: '收入分类', items: incomeCategories },
      ]" :key="group.type" class="group">
        <header class="group-head">
          <h2>{{ group.label }}</h2>
          <button type="button" class="link" @click="startCategoryCreate(group.type)">
            新建
          </button>
        </header>

        <ul>
          <li v-for="(category, index) in group.items" :key="category.id">
            <span class="glyph" :style="{ background: categoryCssColor(category.color) }">
              {{ iconGlyph(category.icon) }}
            </span>
            <span class="name">
              {{ category.name }}
              <span v-if="category.isBuiltin" class="badge">内建</span>
            </span>
            <span class="row-actions">
              <button
                type="button"
                :disabled="busy || index === 0"
                aria-label="上移"
                @click="moveCategory(category.id, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                :disabled="busy || index === group.items.length - 1"
                aria-label="下移"
                @click="moveCategory(category.id, 1)"
              >
                ↓
              </button>
              <button type="button" :disabled="busy" @click="startCategoryEdit(category)">
                编辑
              </button>
              <button
                type="button"
                class="danger"
                :disabled="busy || category.isBuiltin"
                :title="category.isBuiltin ? '内建分类不能删除' : '删除'"
                @click="deleteCategory(category)"
              >
                删除
              </button>
            </span>
          </li>
        </ul>
      </section>
    </template>
  </template>

  <!-- ── accounts ───────────────────────────────────────────────────────── -->
  <template v-else-if="tab === 'accounts'">
    <section v-if="accountDraft" class="editor card">
      <h2>{{ accountDraft.id === null ? '新建账户' : '编辑账户' }}</h2>

      <label class="field">
        <span>名称</span>
        <input v-model="accountDraft.name" type="text" maxlength="40" placeholder="例如：招商银行" />
      </label>

      <label class="field">
        <span>类型</span>
        <select v-model.number="accountDraft.type">
          <option v-for="(label, value) in ACCOUNT_TYPES" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>初始余额（元，可为负）</span>
        <input v-model="accountDraft.balanceText" inputmode="decimal" placeholder="0.00" />
      </label>

      <div class="editor-actions">
        <button type="button" class="primary" :disabled="busy" @click="saveAccount">保存</button>
        <button type="button" class="ghost" @click="accountDraft = null">取消</button>
      </div>
    </section>

    <template v-else>
      <header class="group-head">
        <h2>账户</h2>
        <div class="group-head-actions">
          <span v-if="balances.loaded" class="running-total">
            总余额 {{ formatYuan(balances.totalBalanceCents) }}
          </span>
          <button type="button" class="link" @click="startAccountCreate">新建</button>
        </div>
      </header>

      <ul>
        <li v-for="(account, index) in meta.accounts" :key="account.id">
          <!--
            The whole block is the tap target: it opens the ledger filtered to this account.
            A balance the user cannot follow to its bills is only half an answer, and this
            reuses the existing filtered list rather than adding a second one.
          -->
          <button
            type="button"
            class="name account-link"
            :aria-label="`查看「${account.name}」的账单`"
            @click="openAccountLedger(account)"
          >
            <span class="account-label">
              <span>{{ account.name }}</span>
              <span class="muted small">{{ ACCOUNT_TYPES[account.type] }}</span>
              <span v-if="account.isBuiltin" class="badge">内建</span>
              <span class="muted small">
                初始 {{ formatYuan(account.initialBalanceCents) }}
              </span>
            </span>
            <span
              class="account-balance"
              :class="{ negative: (accountBalanceCents(account) ?? 0) < 0 }"
            >
              {{ accountBalanceText(account) }}
            </span>
          </button>
          <span class="row-actions">
            <button
              type="button"
              :disabled="busy || index === 0"
              aria-label="上移"
              @click="moveAccount(account.id, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              :disabled="busy || index === meta.accounts.length - 1"
              aria-label="下移"
              @click="moveAccount(account.id, 1)"
            >
              ↓
            </button>
            <button type="button" :disabled="busy" @click="startAccountEdit(account)">编辑</button>
            <button
              type="button"
              class="danger"
              :disabled="busy || account.isBuiltin || meta.accounts.length <= 1"
              @click="deleteAccount(account)"
            >
              删除
            </button>
          </span>
        </li>
      </ul>
    </template>
  </template>

  <!-- ── tags ───────────────────────────────────────────────────────────── -->
  <template v-else>
    <section v-if="tagRenameFrom !== null" class="editor card">
      <h2>重命名标签</h2>
      <p class="hint">
        「{{ tagRenameFrom }}」会被改写为新的名字，所有使用它的账单同步更新。
      </p>
      <label class="field">
        <span>新名称</span>
        <input v-model="tagRenameTo" type="text" maxlength="32" />
      </label>
      <div class="editor-actions">
        <button type="button" class="primary" :disabled="busy" @click="saveTagRename">保存</button>
        <button type="button" class="ghost" @click="tagRenameFrom = null">取消</button>
      </div>
    </section>

    <p v-else-if="meta.tags.length === 0" class="empty">
      还没有标签。记账时可以为账单添加标签。
    </p>

    <ul v-else>
      <li v-for="tag in meta.tags" :key="tag.name">
        <span class="name">
          {{ tag.name }}
          <span class="muted small">{{ tag.count }} 笔</span>
        </span>
        <span class="row-actions">
          <button type="button" :disabled="busy" @click="startTagRename(tag)">重命名</button>
          <button type="button" class="danger" :disabled="busy" @click="deleteTag(tag)">
            删除
          </button>
        </span>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  padding: 0.25rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
}

.tabs button {
  min-height: 44px;
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}

.tabs button.active {
  color: var(--on-accent);
  background: var(--accent);
  font-weight: 600;
}

.card {
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
}

.field {
  display: grid;
  gap: 0.3rem;
  margin: 0.75rem 0;
  font-size: 0.85rem;
  color: var(--muted);
  border: 0;
  padding: 0;
}

.field legend {
  padding: 0;
  font-size: 0.85rem;
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

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.icon {
  width: 44px;
  height: 44px;
  font-size: 1.2rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  cursor: pointer;
}

.icon.active {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
}

.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.swatch {
  width: 44px;
  height: 44px;
  border: 2px solid transparent;
  border-radius: 0.5rem;
  cursor: pointer;
}

.swatch.active {
  border-color: var(--fg);
  outline: 2px solid var(--accent);
}

.editor-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.editor-actions button {
  min-height: 44px;
  font: inherit;
  font-weight: 600;
  border-radius: 0.55rem;
  cursor: pointer;
}

.editor-actions .primary {
  color: var(--on-accent);
  background: var(--accent);
  border: 0;
}

.editor-actions .ghost {
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
}

.editor-actions button:disabled {
  opacity: 0.6;
}

.group {
  margin-bottom: 1.25rem;
}

.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0.15rem 0.5rem;
}

.link {
  /* Both axes. `min-height` alone let the two-character 新建 links measure 43.2px wide,
     which the static audit accepts (the declaration is there) but a real finger does not
     get; the browser suite measured the box and failed at 43.9px. */
  min-width: 44px;
  min-height: 44px;
  padding: 0 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
  overflow: hidden;
}

li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 56px;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
}

li:last-child {
  border-bottom: 0;
}

.glyph {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 0.45rem;
  font-size: 1rem;
}

.name {
  flex: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.92rem;
}

.group-head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.running-total {
  font-size: 0.82rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/*
 * The account row is a button, so it needs the tap minimum and the button reset that
 * `.name` (also used by category rows, which are not interactive) does not carry.
 */
.account-link {
  min-height: 44px;
  padding: 0;
  justify-content: space-between;
  font: inherit;
  font-size: 0.92rem;
  text-align: left;
  color: var(--fg);
  background: none;
  border: 0;
  cursor: pointer;
}

.account-label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  min-width: 0;
}

.account-balance {
  flex-shrink: 0;
  font-size: 0.9rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.account-balance.negative {
  color: var(--danger);
}

.small {
  font-size: 0.75rem;
}

.badge {
  padding: 0.05rem 0.35rem;
  font-size: 0.68rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 0.35rem;
}

.row-actions {
  display: flex;
  gap: 0.25rem;
  flex: 0 0 auto;
}

.row-actions button {
  /* 44px minimum touch target: below this, taps miss on a phone. */
  min-width: 44px;
  min-height: 44px;
  padding: 0 0.4rem;
  font: inherit;
  font-size: 0.8rem;
  color: var(--fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  cursor: pointer;
}

.row-actions .danger {
  color: var(--danger);
}

.row-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hint {
  margin: 0.5rem 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--muted);
}

.error {
  margin: 0 0 0.75rem;
  color: var(--danger);
  font-size: 0.85rem;
}

.empty {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}

.muted {
  color: var(--muted);
}
</style>
