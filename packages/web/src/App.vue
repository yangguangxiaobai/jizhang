<script setup lang="ts">
/**
 * Application root.
 *
 * Just the router outlet: the authenticated chrome (header, tab bar) lives in
 * `views/AppShell.vue` so the login page can render without it.
 */
import { RouterView } from 'vue-router';
</script>

<template>
  <RouterView />
</template>
