/** Create/edit form for one possession; photo and ledger references are optional. */
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '../components/AppIcon.vue';
import ItemTransactionPicker from '../components/ItemTransactionPicker.vue';
import { api, ApiError } from '../api/client.js';
import type { Item, ItemCutoutCandidate, ItemCutoutState, ItemStatus, Transaction } from '../api/client.js';
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
const originalPreparedPhoto = ref<PreparedItemPhoto | null>(null);
const previewUrl = ref<string | null>(null);
const optionalFieldsOpen = ref(false);
const removeExistingPhoto = ref(false);
const loading = ref(false);
const saving = ref(false);
const photoProcessing = ref(false);
const cutoutState = ref<ItemCutoutState | null>(null);
const cutoutJobId = ref<string | null>(null);
const cutoutMessage = ref('');
const cutoutCandidates = ref<readonly ItemCutoutCandidate[]>([]);
const selectedCutoutId = ref<string | null>(null);
const cutoutBusy = computed(() => cutoutState.value === 'queued' || cutoutState.value === 'running');
const errorMessage = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let cutoutGeneration = 0;
let cutoutPollTimer: number | undefined;

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
  const jobId = cutoutJobId.value;
  cutoutGeneration += 1;
  if (cutoutPollTimer !== undefined) window.clearTimeout(cutoutPollTimer);
  if (jobId !== null) void api.items.cancelCutoutJob(jobId).catch(() => undefined);
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
  const generation = cutoutGeneration + 1;
  await disposeCutoutJob();
  if (generation !== cutoutGeneration) return;
  cutoutState.value = null;
  cutoutMessage.value = '';
  photoProcessing.value = true;
  errorMessage.value = null;
  try {
    const prepared = await prepareItemPhoto(file);
    if (generation !== cutoutGeneration) return;
    originalPreparedPhoto.value = prepared;
    preparedPhoto.value = prepared;
    selectedCutoutId.value = null;
    cutoutState.value = null;
    cutoutMessage.value = '';
    removeExistingPhoto.value = false;
    setPreview(prepared.blob);
  } catch (error) {
    if (generation !== cutoutGeneration) return;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    if (fileInput.value !== null) fileInput.value.value = '';
  } finally {
    if (generation === cutoutGeneration) photoProcessing.value = false;
  }
}

function cutoutError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CUTOUT_UNAVAILABLE') {
      return 'AI 抠图服务暂时不可用；物品照片仍可普通上传。';
    }
    if (error.code === 'CUTOUT_BUSY') return '抠图服务正忙，请稍后重试。';
    if (error.code === 'CUTOUT_JOB_NOT_FOUND') return '抠图任务已过期，请重新处理。';
    if (error.code === 'CUTOUT_UPSTREAM_INVALID') return '抠图服务返回了无效结果，请重试。';
    if (error.code === 'CUTOUT_INVALID_IMAGE') return '这张图片无法处理，请重新选择。';
  }
  return error instanceof Error ? error.message : '抠图失败，请重试或使用原图。';
}

async function disposeCutoutJob(): Promise<void> {
  const jobId = cutoutJobId.value;
  cutoutGeneration += 1;
  cutoutJobId.value = null;
  photoProcessing.value = false;
  if (cutoutPollTimer !== undefined) {
    window.clearTimeout(cutoutPollTimer);
    cutoutPollTimer = undefined;
  }
  cutoutCandidates.value = [];
  if (jobId !== null) {
    try {
      await api.items.cancelCutoutJob(jobId);
    } catch {
      // The worker has a server-side TTL; an unreachable cleanup must not block photo editing.
    }
  }
}

async function startCutout(): Promise<void> {
  const source = originalPreparedPhoto.value ?? preparedPhoto.value;
  if (source === null || cutoutBusy.value || photoProcessing.value || saving.value) return;
  const generation = cutoutGeneration + 1;
  cutoutState.value = 'queued';
  cutoutMessage.value = '正在提交图片…';
  await disposeCutoutJob();
  if (generation !== cutoutGeneration) return;
  cutoutState.value = 'queued';
  selectedCutoutId.value = null;
  try {
    const created = await api.items.createCutoutJob(source.blob);
    if (generation !== cutoutGeneration) {
      void api.items.cancelCutoutJob(created.jobId).catch(() => undefined);
      return;
    }
    cutoutJobId.value = created.jobId;
    await pollCutout(created.jobId, generation);
  } catch (error) {
    if (generation !== cutoutGeneration) return;
    cutoutState.value = 'failed';
    cutoutMessage.value = cutoutError(error);
  }
}

async function pollCutout(jobId: string, generation: number): Promise<void> {
  while (generation === cutoutGeneration && cutoutJobId.value === jobId) {
    try {
      const job = await api.items.getCutoutJob(jobId);
      if (generation !== cutoutGeneration) return;
      cutoutState.value = job.state;
      cutoutMessage.value = job.message;
      cutoutCandidates.value = job.candidates;
      if (job.state !== 'queued' && job.state !== 'running') return;
    } catch (error) {
      if (generation !== cutoutGeneration) return;
      cutoutState.value = 'failed';
      cutoutMessage.value = cutoutError(error);
      return;
    }

    await new Promise<void>((resolve) => {
      cutoutPollTimer = window.setTimeout(resolve, 1200);
    });
    cutoutPollTimer = undefined;
  }
}

async function cancelCutout(): Promise<void> {
  const jobId = cutoutJobId.value;
  cutoutGeneration += 1;
  cutoutJobId.value = null;
  photoProcessing.value = false;
  if (cutoutPollTimer !== undefined) {
    window.clearTimeout(cutoutPollTimer);
    cutoutPollTimer = undefined;
  }
  cutoutState.value = 'cancelled';
  cutoutMessage.value = '抠图已取消，原照片草稿没有更改。';
  cutoutCandidates.value = [];
  if (jobId !== null) {
    try {
      await api.items.cancelCutoutJob(jobId);
    } catch {
      // A disconnected worker clears transient files at its ten-minute TTL.
    }
  }
}

async function useCutout(candidate: ItemCutoutCandidate): Promise<void> {
  const jobId = cutoutJobId.value;
  const original = originalPreparedPhoto.value;
  if (jobId === null || original === null || cutoutState.value !== 'ready' || photoProcessing.value) {
    return;
  }
  const generation = cutoutGeneration;
  const isCurrentSelection = (): boolean =>
    generation === cutoutGeneration && cutoutJobId.value === jobId;
  photoProcessing.value = true;
  cutoutMessage.value = `正在准备候选 ${Number(candidate.id) + 1}…`;
  try {
    const blob = await api.items.getCutoutCandidateImage(jobId, candidate.id);
    if (!isCurrentSelection()) return;
    if (blob.type.split(';', 1)[0]?.toLowerCase() !== 'image/png') {
      throw new Error('抠图候选格式无效，请重试。');
    }
    const file = new File([blob], 'item-cutout.png', { type: 'image/png' });
    const prepared = await prepareItemPhoto(file);
    if (!isCurrentSelection()) return;
    preparedPhoto.value = prepared;
    removeExistingPhoto.value = false;
    selectedCutoutId.value = candidate.id;
    setPreview(prepared.blob);
    cutoutMessage.value = `已选择候选 ${Number(candidate.id) + 1}；保存物品后才会替换照片。`;
  } catch (error) {
    if (isCurrentSelection()) cutoutMessage.value = cutoutError(error);
  } finally {
    if (isCurrentSelection()) photoProcessing.value = false;
  }
}

function useOriginalPhoto(): void {
  const original = originalPreparedPhoto.value;
  if (original === null) return;
  preparedPhoto.value = original;
  selectedCutoutId.value = null;
  setPreview(original.blob);
  cutoutMessage.value = '已还原原照片草稿；保存时不会使用抠图候选。';
}

function clearPhoto(): void {
  void disposeCutoutJob();
  preparedPhoto.value = null;
  originalPreparedPhoto.value = null;
  cutoutState.value = null;
  cutoutMessage.value = '';
  selectedCutoutId.value = null;
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
  if (saving.value || photoProcessing.value || cutoutBusy.value) return;
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
            v-if="preparedPhoto !== null"
            class="theme-button ghost cutout-start"
            type="button"
            :disabled="photoProcessing || saving || cutoutBusy"
            @click="startCutout"
          >
            <AppIcon name="sparkles" />
            {{ cutoutState === 'failed' ? '重试自动抠图' : 'AI 自动抠图' }}
          </button>
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

      <section
        v-if="cutoutState !== null"
        class="theme-card cutout-panel"
        aria-label="AI 自动抠图"
      >
        <div class="cutout-panel-heading">
          <div>
            <h3>透明候选</h3>
            <p class="hint" role="status">{{ cutoutMessage }}</p>
          </div>
          <button
            v-if="cutoutBusy"
            class="theme-button ghost cutout-cancel"
            type="button"
            @click="cancelCutout"
          >
            取消
          </button>
        </div>

        <div
          v-if="cutoutState === 'ready' && cutoutCandidates.length > 0 && cutoutJobId !== null"
          class="cutout-candidates"
        >
          <button
            v-for="(candidate, index) in cutoutCandidates"
            :key="candidate.id"
            class="cutout-candidate"
            :class="{ selected: selectedCutoutId === candidate.id }"
            type="button"
            :aria-pressed="selectedCutoutId === candidate.id"
            :aria-label="`使用抠图候选 ${index + 1}`"
            :disabled="photoProcessing || saving"
            @click="useCutout(candidate)"
          >
            <span class="cutout-preview">
              <img
                :src="api.items.cutoutCandidatePreviewUrl(cutoutJobId ?? '', candidate.id)"
                :alt="`透明抠图候选 ${index + 1}`"
              />
            </span>
            <span class="cutout-candidate-label">
              {{ selectedCutoutId === candidate.id ? '已选择' : `候选 ${index + 1}` }}
            </span>
          </button>
        </div>

        <button
          v-if="selectedCutoutId !== null && originalPreparedPhoto !== null"
          class="theme-button ghost cutout-original"
          type="button"
          :disabled="photoProcessing || saving"
          @click="useOriginalPhoto"
        >
          还原原照片
        </button>
        <p v-if="photoProcessing" class="cutout-preparing" role="status">
          正在准备所选透明图片…
        </p>
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

.photo-preview,
.cutout-preview {
  background-color: var(--surface);
  background-image:
    linear-gradient(
      45deg,
      var(--surface-soft) 25%,
      transparent 25%,
      transparent 75%,
      var(--surface-soft) 75%,
      var(--surface-soft)
    ),
    linear-gradient(
      45deg,
      var(--surface-soft) 25%,
      transparent 25%,
      transparent 75%,
      var(--surface-soft) 75%,
      var(--surface-soft)
    );
  background-position: 0 0, 8px 8px;
  background-size: 16px 16px;
}

.photo-preview {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  color: var(--accent);
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

.cutout-start,
.cutout-cancel,
.cutout-original {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 44px;
}

.cutout-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.9rem;
}

.cutout-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.cutout-panel-heading > div {
  min-width: 0;
}

.cutout-panel-heading h3 {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
}

.cutout-panel-heading p {
  margin: 0;
}

.cutout-candidates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.cutout-candidate {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
  min-height: 44px;
  padding: 0.45rem;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.cutout-candidate.selected {
  border: 2px solid var(--accent);
  background: var(--accent-subtle);
}

.cutout-preview {
  display: grid;
  place-items: center;
  aspect-ratio: 1.35;
  overflow: hidden;
  padding: 0.3rem;
  border-radius: var(--radius-control);
}

.cutout-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.cutout-candidate-label {
  min-height: 1.35rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.cutout-preparing {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
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

  .cutout-candidates {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
