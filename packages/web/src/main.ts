import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { initTheme } from './composables/useTheme.js';
import { router } from './router/index.js';
import './styles/main.css';

// The stored theme is already on <html> (see `theme-init.js`), so this is not what prevents
// the flash. It starts the listener that keeps a `system` preference following the OS when
// the user changes it while the app is open.
initTheme();

createApp(App).use(createPinia()).use(router).mount('#app');
