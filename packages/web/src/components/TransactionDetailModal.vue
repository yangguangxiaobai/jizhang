<script setup lang="ts">
/**
 * Read-only transaction detail in a modal overlay.
 *
 * Used from the refund candidate picker (so the user can inspect an expense before
 * linking a refund to it) and from the transaction list (quick-view without navigating
 * to the editor). Shows linked refunds and a net-cost calculation for expenses that
 * have been partially or fully reimbursed.
 */
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { TYPE_EXPENSE, TYPE_INCOME, api } from '../api/client.js';
import type { RefundSummary, Transaction } from '../api/client.js';
import { useMetaStore } from '../stores/meta.js';
import { formatDayLabel, formatYuan } from '../utils/money.js';

const props = defineProps<{
  txId: string;
}>();

const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const meta = useMetaStore();
const txn = ref<Transaction | null>(null);
const linkedRefunds = ref<Transaction[]>([]);
const loading = ref(true);
const errorMessage = ref<string | null>(null);

/** Net cost = original expense - total refunded. May be negative (over-refunded). */
function netCostCents(item: Transaction, summary?: RefundSummary): number | null {
  if (item.type !== TYPE_EXPENSE || item.isRefund) return null;
  const totalRefundCents = summary?.totalRefundCents;
  if (totalRefundCents === undefined || totalRefundCents === 0) return null;
  return item.amountCents - totalRefundCents;
}

function edit(): void {
  if (txn.value !== null) {
    emit('close');
    void router.push({ name: 'transaction-edit', params: { id: txn.value.id } });
  }
}

async function loadDetail(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    const item = await api.transactions.get(props.txId);
    txn.value = item;

    // If this is a refund, load the original expenses it is linked to.
    if (item.isRefund && item.refundLinkedTxIds) {
      const results = await Promise.all(
        item.refundLinkedTxIds.map((id) => api.transactions.get(id).catch(() => null)),
      );
      linkedRefunds.value = results.filter((r): r is Transaction => r !== null);
    } else {
      linkedRefunds.value = [];
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadDetail());
watch(() => props.txId, () => void loadDetail());

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close');
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click="onBackdropClick" @keydown="onKey">
      <div class="modal-card" role="dialog" aria-modal="true">
        <button type="button" class="modal-close" aria-label="关闭" @click="emit('close')">
          ✕
        </button>
        <button
          v-if="txn"
          type="button"
          class="modal-edit"
          @click="edit"
        >
          编辑
        </button>

        <p v-if="loading" class="muted">加载中…</p>
        <p v-else-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

        <template v-else-if="txn">
          <div class="detail-header">
            <span class="dot" :style="{ background: meta.categoryColor(txn.categoryId) }" />
            <div class="header-info">
              <span class="header-title">
                {{ meta.categoryName(txn.categoryId) }}
                <span v-if="txn.isRefund" class="badge">退款</span>
                <span v-else-if="txn.type === TYPE_INCOME" class="badge income">收入</span>
              </span>
              <span class="header-sub">{{ formatDayLabel(txn.date) }}</span>
            </div>
            <span
              class="header-amount"
              :class="{ income: txn.type === TYPE_INCOME, refund: txn.isRefund }"
            >
              {{ txn.isRefund || txn.type === TYPE_INCOME ? '+' : '-'
              }}{{ formatYuan(txn.amountCents) }}
            </span>
          </div>

          <dl class="detail-grid">
            <div>
              <dt>账户</dt>
              <dd>{{ meta.accountName(txn.accountId) }}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{{ txn.isRefund ? '退款（收入）' : txn.type === TYPE_EXPENSE ? '支出' : '收入' }}</dd>
            </div>
            <div v-if="txn.note">
              <dt>备注</dt>
              <dd>{{ txn.note }}</dd>
            </div>
            <div v-if="txn.tags.length > 0">
              <dt>标签</dt>
              <dd>
                <span v-for="tag in txn.tags" :key="tag" class="tag-chip">{{ tag }}</span>
              </dd>
            </div>
          </dl>

          <!-- Linked original expenses (shown when this transaction is a refund) -->
          <div v-if="linkedRefunds.length > 0" class="linked-section">
            <h4>关联的原始支出</h4>
            <ul>
              <li v-for="original in linkedRefunds" :key="original.id">
                <span class="dot-sm" :style="{ background: meta.categoryColor(original.categoryId) }" />
                <span class="linked-name">{{ meta.categoryName(original.categoryId) }}</span>
                <span class="linked-date">{{ formatDayLabel(original.date) }}</span>
                <span class="linked-amount expense">-{{ formatYuan(original.amountCents) }}</span>
              </li>
            </ul>
          </div>

          <!-- Refund summary (shown when this is an original expense that has been refunded) -->
          <div
            v-if="txn.refundSummary && txn.refundSummary.refundCount > 0"
            class="refund-summary-section"
          >
            <h4>退款 / 还款记录</h4>
            <div class="summary-row">
              <span>原始支出</span>
              <span class="expense">{{ formatYuan(txn.amountCents) }}</span>
            </div>
            <div class="summary-row">
              <span>已退 / 已还</span>
              <span class="income">{{ formatYuan(txn.refundSummary.totalRefundCents) }}</span>
            </div>
            <div class="summary-row net">
              <span>实际净支出</span>
              <span :class="netCostCents(txn, txn.refundSummary)! <= 0 ? 'income' : 'expense'">
                {{ formatYuan(netCostCents(txn, txn.refundSummary)!) }}
              </span>
            </div>
            <ul v-if="txn.refundDetails && txn.refundDetails.length > 0" class="refund-detail-list">
              <li v-for="detail in txn.refundDetails" :key="detail.id">
                <span class="refund-detail-date">{{ formatDayLabel(detail.date) }}</span>
                <span class="refund-detail-note">{{ detail.note || '退款 / 还款' }}</span>
                <span class="refund-detail-amount income">+{{ formatYuan(detail.amountCents) }}</span>
              </li>
            </ul>
            <p class="refund-count">共 {{ txn.refundSummary.refundCount }} 笔退款关联</p>
          </div>

          <!-- Refund linked info (when this IS the refund) -->
          <div
            v-if="txn.isRefund && txn.refundLinkedTxIds && txn.refundLinkedTxIds.length > 0 && linkedRefunds.length === 0"
            class="linked-section"
          >
            <h4>退款关联</h4>
            <p class="muted small">这笔退款关联了 {{ txn.refundLinkedTxIds.length }} 笔原始支出。</p>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center;background:var(--scrim);backdrop-filter:blur(2px);animation:fadeIn var(--dur-quick) var(--ease-out)}
@keyframes fadeIn{from{opacity:0}}
.modal-card{width:100%;max-width:32rem;max-height:85vh;overflow:auto;padding:1.25rem 1.25rem 1.5rem;background:var(--bg);border-radius:var(--radius-card) var(--radius-card) 0 0;box-shadow:var(--lift-modal);position:relative;animation:slideUp var(--dur-base) var(--ease-out)}
@keyframes slideUp{from{transform:translateY(100%)}}
.modal-close{position:absolute;top:.6rem;right:.6rem;width:36px;height:36px;font-size:1rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}
.modal-close:hover{color:var(--danger);border-color:var(--danger)}
.modal-edit{position:absolute;top:.6rem;right:3.4rem;min-height:36px;padding:0 .8rem;font-size:.88rem;color:var(--accent);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-control);cursor:pointer}
.modal-edit:hover{border-color:var(--accent)}
.detail-header{display:flex;align-items:center;gap:.65rem;margin-bottom:1rem}
.dot{width:.65rem;height:.65rem;border-radius:50%;flex-shrink:0}
.dot-sm{width:.5rem;height:.5rem;border-radius:50%;flex-shrink:0}
.header-info{flex:1;display:grid;gap:.15rem;min-width:0}
.header-title{font-size:1.05rem;font-weight:600}
.header-sub{font-size:.78rem;color:var(--muted)}
.header-amount{flex-shrink:0;font-size:1.2rem;font-weight:600;font-variant-numeric:tabular-nums}
.header-amount.income,.header-amount.refund{color:var(--ok)}
.badge{margin-left:.35rem;padding:.05rem .35rem;font-size:.7rem;color:var(--accent);background:var(--accent-subtle);border:1px solid var(--accent);border-radius:.35rem}
.badge.income{color:var(--ok);background:var(--ok-subtle);border-color:var(--ok)}
.detail-grid{display:grid;gap:.6rem;margin:0 0 1rem;padding:.85rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-control)}
.detail-grid>div{display:grid;gap:.15rem}
dt{font-size:.72rem;color:var(--muted)}
dd{margin:0;font-size:.88rem}
.tag-chip{display:inline-block;margin-right:.3rem;padding:.05rem .4rem;font-size:.75rem;color:var(--muted);border:1px solid var(--border);border-radius:.3rem}
.linked-section{margin-bottom:1rem}
.linked-section h4,.refund-summary-section h4{margin:0 0 .5rem;font-size:.88rem}
.linked-section ul{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--radius-control);overflow:hidden;background:var(--surface)}
.linked-section li{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-bottom:1px solid var(--border);font-size:.85rem}
.linked-section li:last-child{border-bottom:0}
.linked-name{flex:1}
.linked-date{font-size:.75rem;color:var(--muted)}
.linked-amount{flex-shrink:0;font-variant-numeric:tabular-nums}
.expense,.error{color:var(--danger)}
.income{color:var(--ok)}
.refund-summary-section{padding:.85rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-control)}
.summary-row{display:flex;justify-content:space-between;align-items:center;padding:.25rem 0;font-size:.85rem}
.summary-row.net{margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--border);font-weight:600;font-size:.95rem}
.refund-detail-list{list-style:none;margin:.55rem 0 0;padding:.55rem 0 0;border-top:1px solid var(--border)}
.refund-detail-list li{display:flex;align-items:center;gap:.5rem;padding:.3rem 0;font-size:.8rem}
.refund-detail-date{flex-shrink:0;font-size:.72rem;color:var(--muted)}
.refund-detail-note{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.refund-detail-amount{flex-shrink:0;font-variant-numeric:tabular-nums}
.refund-count{margin:.5rem 0 0;font-size:.75rem;color:var(--muted)}
.muted{color:var(--muted)}
.small{font-size:.78rem}
@media(min-width:40rem){.modal-backdrop{align-items:center}.modal-card{border-radius:var(--radius-card)}}
</style>
