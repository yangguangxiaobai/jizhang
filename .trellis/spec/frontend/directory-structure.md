# Frontend Directory Structure

> How frontend code is organized in this project (`packages/web`).
> Established by T1 (`09-11-t1-skeleton`); update this file whenever the layout changes.

---

## Overview

`packages/web` is a Vue 3 + Vite + TypeScript SPA. Vite builds it to
`packages/web/dist`, and **Fastify serves that directory in production** — there is
no separate web container and no CORS configuration, because the app and the API
share one origin.

In development the browser talks to Vite (5173), which proxies `/api` to the
Fastify process on `127.0.0.1:8081`, so dev and production paths are identical
from the app's point of view: always call `/api/v1/...` relative URLs.

```
packages/web/
├─ index.html             # Vite entry; mobile viewport + viewport-fit=cover
├─ vite.config.ts         # plugin-vue + dev proxy /api → 127.0.0.1:8081
├─ tsconfig.json          # module ESNext, moduleResolution bundler, noEmit
└─ src/
   ├─ main.ts             # createApp(App).mount('#app') + global stylesheet import
   ├─ App.vue             # T1: connectivity page (health check); becomes the shell in T4/T9
   ├─ env.d.ts            # vite/client type reference
   ├─ styles/             # global CSS (design tokens as CSS custom properties)
   ├─ components/         # (T4+) reusable presentational components
   ├─ views/              # (T4+) route-level pages
   ├─ router/             # (T4+) vue-router setup
   ├─ stores/             # (T4+) Pinia: auth / meta / transactions / budget
   └─ api/                # (T4+) typed fetch clients — the only place that knows URLs
```

---

## Module Organization

- **`api/` is the only layer that knows endpoint URLs.** Views and stores call
  those functions; no component calls `fetch('/api/v1/...')` directly once T4 lands.
- **`stores/` (Pinia) holds shared state**; component-local state stays in the
  component. Budget figures come from the server (`/budget/overview`) — the front
  end does **not** re-derive them (single source of truth for the money maths).
- **`views/` compose, `components/` render.** A view may talk to stores/routers; a
  reusable component receives props and emits events.
- **Money input/display**: input in yuan with two decimals, convert with
  `Math.round(parseFloat(value) * 100)` before sending — never use a raw float
  product as cents.
- Global styles live in `src/styles`; component-specific styles use `<style scoped>`.

---

## Naming Conventions

| Thing | Rule |
|---|---|
| Components / views | `PascalCase.vue` (`TransactionList.vue`), one component per file |
| Component file ↔ component name | must match; multi-word except the root `App.vue` |
| Composables | `useXxx.ts` in the folder that owns the concern |
| Stores | `useXxxStore.ts` |
| Non-component modules | `camelCase.ts` / `kebab-case.ts` |
| Tests | `<name>.test.ts` next to the unit (vitest; none yet — T4/T5 add them) |

---

## Type & Build Rules

- TypeScript strict mode via the shared `tsconfig.base.json`; the web package adds
  `moduleResolution: bundler`, DOM libs and `types: ["vite/client"]`.
- `verbatimModuleSyntax` is on: use `import type { ... }` for type-only imports.
- `build` runs `vue-tsc --noEmit` **before** `vite build`, so a type error fails the
  build and, in turn, the Docker image.
- Environment variables are not used in the front end: everything the browser needs
  comes from `/api/v1/**`. Do not introduce `VITE_*` secrets.
- All built assets must remain servable by `@fastify/static` from a flat directory,
  so keep Vite's default `assets/` output layout.

---

## Forbidden Patterns

- Absolute API origins (`http://localhost:8081/...`) in app code — always relative
  `/api/v1/...`, otherwise dev works and the container breaks.
- `parseFloat(x) * 100` used directly as an integer amount (floating point error).
- Duplicating budget/expense logic that also exists in `packages/shared`.
- Reading `window.location` to build API URLs.
- Shipping a route/path assumption that the server's SPA fallback cannot serve
  (the fallback returns `index.html` for any non-`/api` GET, so client-side routes
  are fine, but the API prefix must never be shadowed).

---

## Examples

- Entry wiring: `packages/web/src/main.ts`.
- Data-fetching shape used before the typed `api/` layer exists:
  `packages/web/src/App.vue` (load on mount, explicit loading/error/data refs,
  manual re-check button).
- Dev proxy configuration: `packages/web/vite.config.ts`.
