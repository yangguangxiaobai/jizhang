/** Create/edit form for one possession; photo and ledger references are optional. */
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import ItemTransactionPicker from '../components/ItemTransactionPicker.vue';
import { api } from '../api/client.js';
import type { Item, ItemStatus, Transaction } from '../api/client.js';
import { useItemsStore } from '../stores/items.js';
import {
  formatCents,
  fromDateInputValue,
  parseOptionalYuanToCents,
  toDateInputValue,
} from '../utils/money.js';
import { prepareItemPhoto, type PreparedItemPhoto } from '../utils/item-photo.js';

const route = useRoute();
const router = useRouter();
const itemsStore = useItemsStore();
const id = ref<string | null>(null);
const currentStatus = ref<ItemStatus>('active');
const name = ref('');
const category = ref('其他');
const brand = ref('');
const model = ref('');
const note = ref('');
const purchasePriceText = ref('');
const purchaseDateText = ref(toDateInputValue(Date.now()));
const purchaseTransactionId = ref<string | null>(null);
const serverPhotoUrl = ref<string | null>(null);
const preparedPhoto = ref<PreparedItemPhoto | null>(null);
const previewUrl = ref<string | null>(null);
const optionalFieldsOpen = ref(false);
const removeExistingPhoto = ref(false);
const loading = ref(false);
const saving = ref(false);
const photoProcessing = ref(false);
const errorMessage = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => id.value !== null);
const liveStatus = computed(
  () => currentStatus.value === 'active' || currentStatus.value === 'idle',
);
const shownPhotoUrl = computed(
  () => previewUrl.value ?? (removeExistingPhoto.value ? null : serverPhotoUrl.value),
);
const amountValue = computed(() => parseOptionalYuanToCents(purchasePriceText.value));
const categories = computed(() => itemsStore.categories);

function setPreview(blob: Blob | null): void {
  if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = blob === null ? null : URL.createObjectURL(blob);
}

function goBack(): void {
  if (id.value === null) void router.push({ name: 'items' });
  else void router.push({ name: 'item-detail', params: { id: id.value } });
}

async function loadItem(itemId: string): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    const item = await api.items.get(itemId);
    id.value = item.id;
    currentStatus.value = item.status;
    name.value = item.name;
    category.value = item.category;
    brand.value = item.brand;
    model.value = item.model;
    note.value = item.note;
    purchasePriceText.value =
      item.purchasePriceCents === null ? '' : formatCents(item.purchasePriceCents);
    purchaseDateText.value = toDateInputValue(item.purchaseDate);
    purchaseTransactionId.value = item.purchaseTransactionId;
    serverPhotoUrl.value = item.photoUrl;
    optionalFieldsOpen.value = item.brand !== '' || item.model !== '' || item.note !== '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await itemsStore.load();
  const routeId = route.params['id'];
  if (typeof routeId === 'string' && routeId !== '') await loadItem(routeId);
});

onUnmounted(() => {
  if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value);
});

function onPurchaseTransactionSelected(transaction: Transaction | null): void {
  if (transaction === null) return;
  purchasePriceText.value = formatCents(transaction.amountCents);
  purchaseDateText.value = toDateInputValue(transaction.date);
}

async function onPhotoSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  photoProcessing.value = true;
  errorMessage.value = null;
  try {
    const prepared = await prepareItemPhoto(file);
    preparedPhoto.value = prepared;
    removeExistingPhoto.value = false;
    setPreview(prepared.blob);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    if (fileInput.value !== null) fileInput.value.value = '';
  } finally {
    photoProcessing.value = false;
  }
}

function clearPhoto(): void {
  preparedPhoto.value = null;
  setPreview(null);
  removeExistingPhoto.value = serverPhotoUrl.value !== null;
  if (fileInput.value !== null) fileInput.value.value = '';
}

function parsePurchaseAmount(): number | null {
  const parsed = amountValue.value;
  if (purchasePriceText.value.trim() !== '' && parsed === null) {
    throw new Error('购入价格请输入有效的非负金额。');
  }
  return parsed;
}

async function save(): Promise<void> {
  if (saving.value || photoProcessing.value) return;
  errorMessage.value = null;
  saving.value = true;
  try {
    const purchaseDate = fromDateInputValue(purchaseDateText.value);
    if (purchaseDate === null) throw new Error('请选择有效的购入日期。');
    const purchasePriceCents = parsePurchaseAmount();
    const base = {
      name: name.value.trim(),
      category: category.value.trim() || '其他',
      brand: brand.value.trim(),
      model: model.value.trim(),
      note: note.value.trim(),
      purchasePriceCents,
      purchaseDate,
      purchaseTransactionId: purchaseTransactionId.value,
    };
    if (base.name === '') throw new Error('请填写物品名称。');

    let item: Item;
    if (id.value === null) {
      item = await api.items.create({
        ...base,
        status: currentStatus.value === 'idle' ? 'idle' : 'active',
      });
      id.value = item.id;
    } else {
      const changes: Record<string, unknown> = { ...base };
      if (liveStatus.value) changes['status'] = currentStatus.value;
      item = await api.items.update(itemId(), changes);
    }

    if (preparedPhoto.value !== null) {
      await api.items.uploadPhoto(item.id, preparedPhoto.value.mimeType, preparedPhoto.value.blob);
      preparedPhoto.value = null;
    } else if (removeExistingPhoto.value) {
      await api.items.removePhoto(item.id);
      removeExistingPhoto.value = false;
    }
    await itemsStore.reload();
    await router.replace({ name: 'item-detail', params: { id: item.id } });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}

function itemId(): string {
  if (id.value === null) throw new Error('物品编号缺失，请返回物品列表重试。');
  return id.value;
}
</script>

<template>
  <section class="item-edit-page" aria-label="物品信息">
    <header class="item-page-heading">
      <button class="theme-button ghost back-button" type="button" @click="goBack">
        <AppIcon name="chevron" /> 返回
      </button>
      <div class="item-heading-copy">
        <h2>{{ isEditing ? '编辑物品信息' : '完善物品信息' }}</h2>
        <p class="hint">记录物品的购入信息和使用状态。</p>
      </div>
    </header>

    <p v-if="loading" class="muted" role="status">正在加载物品…</p>

    <form v-else class="item-edit-form" @submit.prevent="save">
      <section class="theme-card photo-card">
        <div class="photo-preview">
          <img v-if="shownPhotoUrl !== null" :src="shownPhotoUrl" :alt="name || '物品照片预览'" />
          <AppIcon v-else name="box" />
        </div>
        <div class="photo-actions">
          <strong>{{ shownPhotoUrl === null ? '添加物品照片' : '物品照片' }}</strong>
          <p class="hint">可选；照片会随账本备份保存。</p>
          <label class="theme-button ghost photo-pick">
            {{
              photoProcessing ? '正在处理图片…' : shownPhotoUrl === null ? '选择照片' : '更换照片'
            }}
            <input
              ref="fileInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              :disabled="photoProcessing || saving"
              @change="onPhotoSelected"
            />
          </label>
          <button
            v-if="shownPhotoUrl !== null"
            class="text-action"
            type="button"
            :disabled="saving"
            @click="clearPhoto"
          >
            移除照片
          </button>
        </div>
      </section>

      <section class="theme-card form-card">
        <label class="field">
          <span>物品名称</span>
          <input
            v-model="name"
            required
            maxlength="120"
            autocomplete="off"
            placeholder="例如：Sony α7C II"
          />
        </label>

        <div class="field-grid">
          <label class="field">
            <span>购入价格（可留空）</span>
            <input
              v-model="purchasePriceText"
              inputmode="decimal"
              autocomplete="off"
              placeholder="例如：8799.00"
            />
          </label>
          <label class="field">
            <span>购入日期</span>
            <input v-model="purchaseDateText" type="date" required />
          </label>
        </div>

        <label class="field">
          <span>物品分类</span>
          <input
            v-model="category"
            list="item-category-options"
            maxlength="60"
            autocomplete="off"
            placeholder="例如：数码 / 摄影器材"
          />
          <datalist id="item-category-options">
            <option v-for="value in categories" :key="value" :value="value" />
          </datalist>
        </label>

        <label v-if="liveStatus" class="field">
          <span>当前状态</span>
          <div class="status-options" role="group" aria-label="当前状态">
            <button
              type="button"
              :class="{ active: currentStatus === 'active' }"
              :aria-pressed="currentStatus === 'active'"
              @click="currentStatus = 'active'"
            >
              使用中
            </button>
            <button
              type="button"
              :class="{ active: currentStatus === 'idle' }"
              :aria-pressed="currentStatus === 'idle'"
              @click="currentStatus = 'idle'"
            >
              闲置
            </button>
          </div>
        </label>
        <div v-else class="current-status">
          <span>当前状态</span>
          <strong>{{ currentStatus === 'sold' ? '已售出' : '已退役' }}</strong>
          <small>结束持有状态如需更正，请在物品详情页重新启用。</small>
        </div>

        <details
          class="optional-fields"
          :open="optionalFieldsOpen"
          @toggle="optionalFieldsOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>品牌、型号和备注 <span>可选</span></summary>
          <div class="optional-fields-body">
            <div class="field-grid">
              <label class="field">
                <span>品牌</span>
                <input
                  v-model="brand"
                  maxlength="500"
                  autocomplete="off"
                  placeholder="例如：Sony"
                />
              </label>
              <label class="field">
                <span>型号</span>
                <input v-model="model" maxlength="500" autocomplete="off" />
              </label>
            </div>
            <label class="field">
              <span>备注</span>
              <textarea v-model="note" maxlength="500" rows="3" placeholder="记录你想保留的信息" />
            </label>
          </div>
        </details>
      </section>

      <section class="theme-card link-card">
        <ItemTransactionPicker
          :model-value="purchaseTransactionId"
          purpose="purchase"
          :disabled="saving"
          @update:model-value="purchaseTransactionId = $event"
          @selected="onPurchaseTransactionSelected"
        />
      </section>

      <p v-if="errorMessage !== null" class="error" role="alert">{{ errorMessage }}</p>

      <div class="form-actions">
        <button class="theme-button" type="submit" :disabled="saving || photoProcessing">
          {{ saving ? '保存中…' : '保存物品' }}
        </button>
        <button class="theme-button ghost" type="button" :disabled="saving" @click="goBack">
          取消
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.item-edit-page {
  display: grid;
  gap: 0.75rem;
  max-width: 46rem;
  margin: 0 auto;
}

.item-page-heading {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.65rem;
}

.item-heading-copy h2,
.item-heading-copy p {
  margin: 0;
}

.item-heading-copy h2 {
  font-size: 1.1rem;
}

.back-button {
  justify-self: start;
  min-height: 44px;
}

.item-edit-form {
  display: grid;
  gap: 0.75rem;
  padding-bottom: 1rem;
}

.photo-card {
  display: grid;
  grid-template-columns: minmax(88px, 112px) minmax(0, 1fr);
  gap: 0.8rem;
  align-items: center;
  padding: 0.85rem;
}

.photo-preview {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  color: var(--accent);
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.photo-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.photo-preview :deep(.app-icon) {
  width: 2rem;
  height: 2rem;
}

.photo-actions {
  display: grid;
  justify-items: start;
  gap: 0.35rem;
  min-width: 0;
}

.photo-actions p {
  margin: 0;
}

.photo-pick {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0.45rem 0.75rem;
  overflow: hidden;
}

.photo-pick input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 44px;
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
}

.text-action {
  min-height: 44px;
  padding: 0.3rem 0.5rem;
  color: var(--danger);
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 0.85rem;
}

.form-card {
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
}

.field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.field > span,
.current-status > span {
  color: var(--muted);
  font-size: 0.85rem;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.55rem 0.65rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  box-sizing: border-box;
  font: inherit;
  font-size: 16px;
}

.field textarea {
  min-height: 88px;
  resize: vertical;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.status-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
  padding: 0.25rem;
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}

.status-options button {
  min-height: 44px;
  padding: 0.45rem 0.75rem;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-control);
  font: inherit;
}

.status-options button.active {
  color: var(--accent);
  background: var(--surface);
  box-shadow: var(--lift-1);
  font-weight: 650;
}

.optional-fields {
  border-top: 1px solid var(--border);
}

.optional-fields summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  color: var(--fg);
  font-weight: 600;
  cursor: pointer;
}

.optional-fields summary span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 400;
}

.optional-fields-body {
  display: grid;
  gap: 0.8rem;
  padding: 0.35rem 0 0.1rem;
}

.current-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.current-status strong {
  color: var(--accent);
}

.current-status small {
  flex-basis: 100%;
  color: var(--muted);
  font-size: 0.78rem;
}

.link-card {
  padding: 1rem;
}

.form-actions {
  position: sticky;
  bottom: calc(4.5rem + env(safe-area-inset-bottom));
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.6rem;
  padding: 0.45rem 0;
  background: var(--bg);
}

.form-actions button {
  min-height: 48px;
}

.form-actions .ghost {
  min-width: 5rem;
}

@media (min-width: 64rem) {
  .form-actions {
    bottom: 0.75rem;
  }
}

@media (min-width: 40rem) {
  .item-edit-page,
  .item-edit-form {
    gap: 1rem;
  }

  .photo-card,
  .form-card,
  .link-card {
    padding: 1.15rem;
  }
}
</style>
