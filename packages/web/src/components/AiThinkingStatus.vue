<script setup lang="ts">
/** Keeps the in-flight assistant request visibly active without inventing progress percentages. */
defineProps<{ active: boolean }>();
</script>

<template>
  <div v-if="active" class="notice notice-accent" role="status" aria-live="polite">
    <strong>AI 正在处理</strong>
    <p>正在处理请求，请稍等。</p>
    <progress aria-label="AI 正在处理" />
  </div>
</template>
