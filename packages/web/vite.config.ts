import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { themeInitPlugin } from './src/vite-plugin-theme-init.js';

/**
 * Service-worker policy for a bookkeeping app that requires a login.
 *
 * ## What IS cached
 *
 * The application shell only: hashed JS/CSS chunks, the icons and the HTML entry.
 * That is what makes "open it on the train and still see the app" work.
 *
 * ## What is deliberately NOT cached
 *
 * **Nothing under `/api/`.** A `NetworkOnly` route covers the whole API for two
 * reasons:
 *
 * 1. **Correctness of the offline promise.** This app is online-first by design
 *    (parent task D4): writes need the network, so offline is "you can look at the
 *    app", not "you can look at stale numbers that quietly disagree with the server".
 * 2. **Privacy.** API responses are per-session and carry the ledger. A response
 *    cache keyed by URL alone would survive a logout and hand the next visitor the
 *    previous user's data on a shared device.
 *
 * The cost — no offline data view — is a deliberate, documented trade-off rather than
 * an oversight. Verified by `pnpm --filter @jizhang/web run preview` + DevTools
 * offline, and asserted by `scripts/check-pwa.mjs`.
 */
export default defineConfig({
  plugins: [
    vue(),
    // Inlines the stored theme into the head before first paint, so a dark preference does
    // not flash white while the bundle downloads.
    themeInitPlugin(),
    VitePWA({
      // Update in the background and take effect on the next load, so a stale tab
      // cannot be pinned to an old build indefinitely.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-32x32.png'],
      manifest: {
        name: '记账 · 信封预算',
        short_name: '记账',
        description: '信封预算法个人记账，自建服务器部署',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Must match --bg / --accent in src/styles/main.css.
        background_color: '#f7f5f1',
        theme_color: '#2f6f8f',
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: '记一笔', short_name: '记一笔', url: '/transactions/new' },
          { name: '预算', short_name: '预算', url: '/budget' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // A navigation request must never be answered with an API response or vice
        // versa; only non-API navigations get the cached shell.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Explicitly NetworkOnly: no API response is ever written to a cache.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
      devOptions: {
        // Keep the SW out of `vite dev` so hot reload is not fought by a cache.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Dev only: the API lives in the Fastify process, so proxy /api to it and
    // keep everything same-origin (no CORS, no preflight).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
