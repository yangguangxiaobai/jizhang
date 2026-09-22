<script setup lang="ts">
/**
 * Gives an AI request a calm, conversational progress surface without inventing a numeric
 * percentage. Messages are intentionally framed as processing hints, not provider telemetry.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    active: boolean;
    messages?: readonly string[];
    title?: string;
  }>(),
  {
    messages: () => ['我正在处理这次请求，请稍等…'],
    title: 'AI 正在处理',
  },
);

const messageIndex = ref(0);
let timer: number | undefined;

const currentMessage = computed(
  () => props.messages[messageIndex.value % Math.max(props.messages.length, 1)] ?? '我正在处理这次请求，请稍等…',
);

function stopRotation(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function startRotation(): void {
  stopRotation();
  messageIndex.value = 0;
  if (props.messages.length < 2) return;
  timer = window.setInterval(() => {
    messageIndex.value = (messageIndex.value + 1) % props.messages.length;
  }, 1_700);
}

watch(
  () => props.active,
  (active) => {
    if (active) startRotation();
    else stopRotation();
  },
  { immediate: true },
);

onBeforeUnmount(stopRotation);
</script>

<template>
  <div v-if="active" class="notice notice-accent" role="status" aria-live="polite">
    <strong>{{ title }}</strong>
    <p>{{ currentMessage }}</p>
    <small>请稍等，完成后会自动收起。</small>
  </div>
</template>
