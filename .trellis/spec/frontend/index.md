# Frontend Development Guidelines

> `packages/web` — Vue 3 + Vite + TypeScript, built as an installable PWA and served by the
> Fastify process at the same origin as the API.

---

## Overview

Three properties shape everything below:

1. **The primary device is an iPhone.** Touch targets, safe areas, focus-zoom and
   installability are correctness concerns here, not polish.
2. **The client renders; it does not compute.** Every accounting figure — net expense, the
   carryover pool, charts — is computed by the server from `@jizhang/shared`. A second
   implementation on the client is how the pages start disagreeing.
3. **The bundle is small on purpose** (~42 kB gzipped main chunk). Charts are hand-rolled
   SVG; icons are generated. Dependencies have to earn their kilobytes.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Done |
| [Component Guidelines](./component-guidelines.md) | SFC anatomy, mobile-first rules, a11y | Done |
| [Composables](./hook-guidelines.md) | `composables/`, module-scope state, why fetching lives in stores | Done |
| [State Management](./state-management.md) | Pinia stores, local vs global, refresh paths | Done |
| [Quality Guidelines](./quality-guidelines.md) | Build-output verification, the PWA caching policy | Done |
| [Type Safety](./type-safety.md) | `noUncheckedIndexedAccess`, the API boundary, cents-by-convention | Done |
| [Motion Guidelines](./motion-guidelines.md) | The twelve principles as a token system, and what is refused | Done |
| [Colour Guidelines](./color-guidelines.md) | The token ladder, the presets, the category palette, and the contrast floors that are measured | Done |

---

## Where to look first

| If you are… | Read |
|---|---|
| adding a page | `directory-structure.md`, then `state-management.md` |
| touching money or dates | `type-safety.md` and `utils/money.ts` |
| changing the service worker or manifest | `quality-guidelines.md` § forbidden patterns (the `/api/` caching rule) |
| building a mobile layout | `component-guidelines.md` § mobile-first rules |
| adding a transition, an animation or a shadow | `motion-guidelines.md` — every duration must be a token, and a keyframe may not declare a `to` frame |
| adding a colour, a callout, a chart series or a preset | `color-guidelines.md` — every colour is a token, every pair has a measured floor, and the palette order is validated |
| unsure where a value should be computed | `state-management.md` § "Server data is cached, not recomputed" |

---

## The rule most likely to be broken

**Do not re-derive a total on the client.** Formatting cents is fine; summing expenses, or
deciding what counts as income, is not. The refund rule ("a refund is a negative expense and
never income") lives in one place, and duplicating it would make the budget page and the
charts page silently disagree.

---

## Theming, and two traps that hid in plain sight

Every colour comes from a token in `styles/main.css`. Theming is therefore a matter of
supplying values, not of editing components — with two exceptions that were real defects.
The full ladder (four hues on three rungs, three colour presets, the twelve-slot category
palette, and the contrast floors that are measured on every build) is in
`color-guidelines.md`; the two traps that shaped it are kept here because they are the
ones most likely to be reintroduced.

### `--fg` and `--ok` were referenced everywhere and defined nowhere

The token was `--text`; `--fg` did not exist, and neither did `--ok`, though nearly every view
wrote `color: var(--fg)` and several wrote `var(--ok, …)`. An undefined custom property makes
the whole declaration invalid at computed-value time, so those colours silently fell back to
inheritance. The light theme looked roughly right by accident, which is why it survived; the
dark theme did not. Both names are now defined (and `--text`, which nothing used, is gone).

`scripts/check-color.mjs` now fails the build on a referenced-but-undefined colour token and
on a defined-but-unreferenced one — the check that would have caught this.

### Text on `--accent` needs `--on-accent`, not `#fff`

The dark accent is a light blue, and white on it measures **2.54:1** — below the 3:1 floor.
Twenty-five buttons had a hard-coded `color: #fff`, so the dark theme shipped with unreadable
button labels. Use `--on-accent`: white in light mode, near-black in dark. The same rung exists
for `ok` and `warning`; a colour literal in a component `<style>` now fails the build.

### Three-state theme preference, and the colour preset beside it

`system` / `light` / `dark`. `system` removes the `data-theme` attribute so the media query
takes over; the explicit values are attribute selectors that WIN over it. A two-state toggle
cannot express "go back to following the system", which is the state most people want.

`data-accent` works the same way one level down: absent is 钛蓝, `forest` and `mono` are
explicit. Presets coordinate the accent, page background, soft surface and hero card while
ordinary surfaces and financial-state/category colors remain shared. See `color-guidelines.md`
for the allowlist, canonical SVG previews, and hero-text contrast pairs.

Both attributes are set before first paint by `theme-init.js`, inlined by
`src/vite-plugin-theme-init.ts` at the `<!--theme-init-->` placeholder. Without it the page
paints light and snaps to dark.

### There is no app lock, and it was removed on purpose

An earlier release shipped a PIN gate (`composables/useLock.ts` + `LockScreen.vue`). It was
deleted in `09-12-iphone-delivery`: the app targets a single-user iPhone and the gate bought
very little, while costing a cold-start prompt on every refresh and a whole class of state to
reason about.

The reasoning is worth keeping even though the code is gone, because it is the reason not to
re-add it casually: **a client-side PIN is not a security boundary.** The ledger is on the
server and the real credential is the session cookie, so anyone who can reach the API can read
the data with or without the PIN. It only covered handing someone an unlocked phone — and the
same person can read the account in Settings.

A stored `jizhang.pin` value from an older release must stay inert; `iphone.spec.mjs` seeds
one and asserts that the app still loads and that no lock UI exists, so a stale record cannot
lock anyone out of their own ledger.

Login is the real boundary: `POST /api/v1/auth/login` + the session cookie, unchanged.

---

## Navigation and the landing route

Six bottom tabs, in this order: **首页 / 账单 / 预算 / 记一笔 / 统计 / 我的**.

`AppIcon.vue` supplies local line icons; visible labels remain the accessible names. Selection
uses a tinted glyph pill and stronger text (not color alone), with the existing press/glyph
motion. The record-entry action stays fourth, not a new floating overlay.

`/` is the dashboard. `TransactionsView` lives at `/transactions` and **keeps the route name
`transactions`** — the name is the contract (`router.push({ name: 'transactions' })`, the
"查看全部" link, and the e2e suites all depend on it); only the path moved. If you add a
route, do not repurpose an existing `name`.

The tab labels are asserted by `packages/server/scripts/e2e-home.mjs` against the **served
bundle**, so removing or renaming a tab fails the suite rather than passing review.

---

**Language**: All documentation is written in **English**, matching the code comments.
User-facing strings (UI copy) are in **Chinese**, because the user is.
