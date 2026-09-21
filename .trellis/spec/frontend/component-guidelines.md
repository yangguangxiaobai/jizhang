# Component Guidelines — Frontend

> Vue 3 SFCs, `<script setup lang="ts">`, scoped styles, mobile-first.

---

## Anatomy of a component here

Component order is fixed, so any file reads the same way:

1. `composables/useNetwork.ts` first — see below for why it is the most-used case
2. `<script setup lang="ts">` with the JSDoc comment explaining **why the component
   exists**, not what it renders
3. stores, then local `ref`s, then `computed`s, then functions
4. `<template>`
5. `<style scoped>`

Props use `defineProps<{ ... }>()` with `withDefaults` when a default is needed:

```ts
const props = withDefaults(
  defineProps<{
    slices: readonly Slice[];
    innerRatio?: number;
    size?: number;
  }>(),
  { innerRatio: 0.58, size: 180 },
);
```

Import types separately (`import type { Slice }`) — `verbatimModuleSyntax` requires it.

---

## Components vs views

- **`views/`** — one per route, owns data loading (`onMounted`), talks to stores, and is
  allowed to be long.
- **`components/`** — presentational and reusable, receives props, owns no store state
  unless genuinely global.

If a component needs to know which page it is on, it is a view.

---

## Hand-rolled SVG, not a chart library

`DonutChart.vue` and `BarChart.vue` are hand-written SVG. Two chart shapes do not justify
tens of kilobytes on a phone bundle, and the geometry stays inspectable and testable instead
of hidden inside a canvas.

The same reasoning applies to icons: `scripts/generate-icons.mjs` writes the PNGs with a
hand-rolled encoder over Node's `zlib`, so there is no image dependency and no
unreviewable binary blob.

When adding a chart, prefer extending these over introducing a dependency; if the geometry
gets genuinely complex, say so explicitly rather than pulling in a library by reflex.

---

## Mobile-first rules (these are requirements, not preferences)

| Rule | Why |
|---|---|
| Every interactive target is **>= 44x44 px** | Apple's minimum; below it, taps miss |
| Form controls are **>= 16px** font | below 16px iOS Safari zooms the page on focus |
| Bottom-anchored bars carry `env(safe-area-inset-bottom)` | otherwise the home indicator covers them |
| Top bars carry `env(safe-area-inset-top)` | otherwise the notch overlaps the title |
| No horizontal overflow at 375px | the narrowest phone worth supporting |
| **Never** `user-scalable=no` | pinch-zoom is an accessibility feature; the 16px rule solves the real problem |

### Three independent checks enforce them

`scripts/check-mobile.mjs` runs during `pnpm build` and audits the CSS **source** — it
catches a declared `min-height: 32px` on a button, a sub-16px input, and a `min-width`
wider than the viewport. It also flags a `<select>`/`<textarea>` used in a template with **no
CSS rule naming it at all**, which is how an unstyled 19px cycle picker passed every check
until a browser measured it: a rule that does not exist cannot declare a bad height, so the
size audit is blind to it. A rule naming a **pseudo-element** is skipped: `.tab::after` is
the active-tab indicator, 2px tall on purpose, and no finger ever lands on it.

`scripts/check-motion.mjs` also runs during `pnpm build` and audits the movement, so that a
`transition: all`, a literal `0.3s`, a keyframe that animates `width` or a `@keyframes` name
that is defined but never referenced fails the build instead of quietly doing nothing. See
`motion-guidelines.md`.

`scripts/check-color.mjs` runs beside it and audits the colours: a literal in a component, a
token referenced but undefined (or defined but unused), two hand-duplicated theme blocks that
disagree, a text pair under 4.5:1 in any theme × preset, a category palette that fails the
separation gates, or a manifest/meta/icon value that has drifted from the stylesheet. See
`color-guidelines.md`.

`scripts/lib/browser.mjs` fills the rest: a shared headless-Chrome driver (login over the
API, inject the session cookie, navigate, read and measure the DOM, stop/start the
container). Per-view suites sit on top of it — `render-dashboard.mjs`, `render-trash.mjs`,
`render-budget.mjs`, `render-recurring.mjs`, `render-theme.mjs`, `render-motion.mjs`,
`render-color.mjs` — and
each **measures the rendered boxes**: tab count, per-tab width/height, `document.scrollWidth`,
and every interactive element shorter than 44px.

`render-theme.mjs` additionally computes **WCAG contrast ratios from the rendered colours**.
That is not decoration: it caught the light-blue accent with white text at 2.54:1, a defect no
source audit could see. Measure contrast rather than eyeballing a screenshot.

Share the driver rather than copying it: a second hand-rolled copy is how the two suites
would start disagreeing about what "44px" or "offline" means. Add a view by adding a thin
suite, not a new driver.

Two things the driver already handles, both of which cost a debugging round:

- **The Chrome profile must be per-suite and deleted.** Chrome caches aggressively in
  `--user-data-dir`; a reused profile serves the previous build and reports the old DOM —
  a *silent false pass*, not an error.
- **`close()` waits for the process to exit before removing the profile.** On Windows
  Chrome holds Crashpad files open, and an unhandled `EBUSY` there masks the suite's own
  result line.

When you add a screen, prefer extending a suite's measured assertions over eyeballing a
screenshot. `render-dashboard.mjs` has already caught a defect the static audit passed: an
alert line assembled from sibling `<template v-if>` fragments rendered as
`，已从结余池借用` — a dangling comma with no leading clause. **Compose a sentence in a
computed, or render it whole; never concatenate prose across conditional fragments.**

### A `watch` that clears a message can clear the one you just set

When a handler writes state that a watcher also reacts to, the watcher can undo the handler's
own work in the same tick — and the result is a control that appears to do nothing.

The original case: a PIN field set an error and then cleared the input so the user would
retype. Clearing the input was itself a change, so a naive `watch(pin, () => (error.value =
null))` wiped the message and a wrong PIN produced **no feedback at all**. Guard the watcher
against changes the code makes itself (`next !== ''`). (That screen is gone — see
`index.md` — but the shape recurs on any form that resets a field on submit.)

The general shape: when a watcher reacts to state the same function also writes, the reaction
can undo the function's own work. A browser test caught this; no unit test would have, because
the state was correct — only the rendered result was not.

---

## Styling

Scoped CSS with the theme tokens from `styles/main.css`: the neutrals (`--bg`, `--surface`,
`--fg`, `--muted`, `--border`), the four hues on three rungs (`--accent` / `--on-accent` /
`--accent-subtle`, and the same for `ok`, `warning`, `danger`), and the category palette
`--cat-1` … `--cat-12`. See `color-guidelines.md` for the ladder and the measured floors.

- No CSS framework. The app is small and a utility layer would be a second vocabulary.
- **No colour literal in a component `<style>`** — a hex, `rgb()` or `hsl()` there fails the
  build (`scripts/check-color.mjs`). A colour that must match the accent is `var(--accent)`;
  text on it is `var(--on-accent)`. Category colours come from the database and are applied
  inline **in the template**, usually as a `var(--cat-N)` token via `categoryCssColor()`
  (the one sanctioned exception).
- A callout is `.notice` + `.notice-{accent|ok|warning|danger}` from `main.css`; the view adds
  margins only and never restates the tint.
- Keep `min-height` on buttons rather than `height`, so text scaling cannot clip a label.
- Every duration and easing comes from a motion token — `var(--dur-base)`,
  `var(--ease-out)`. A literal `0.3s` fails the build; see `motion-guidelines.md`.

### Every view is a fragment, and that is load-bearing

No view has a single root element, which is why there is no `<Transition>` around
`<RouterView>`: a transition around a fragment does nothing, silently. `AppShell.vue` wraps
the outlet in a route-keyed `<div class="view-slot">` and the arrival is CSS on
`.view-slot > *`, so a screen gets a staged reveal without containing any motion code.

---

## Accessibility

- A control that is only an icon needs `aria-label`; a decorative glyph needs
  `aria-hidden="true"`.
- Toggle-like buttons carry `aria-pressed`; tab strips carry `role="tablist"`/`aria-pressed`.
- Error and status text uses `role="alert"` (assertive) for failures and `role="status"`
  (polite) for confirmations, so a screen reader announces them without stealing focus.
- Progress bars expose `role="progressbar"` with `aria-valuenow`/`min`/`max`.
- `<fieldset>` + `<legend>` for grouped inputs (icon and colour pickers).
- Never convey state by colour alone: an over-budget module also shows a negative number.

---

## Common mistakes

- A clickable `<div>`: use `<button>` so keyboard and screen readers work.
- Placing `env(safe-area-inset-bottom)` on the page instead of the fixed bottom bar, so the
  padding lands in the wrong place.
- Growing a component instead of extracting one; the transactions page already reached 92 kB
  in its Flutter ancestor by accumulating concerns.
- Reaching for a library for one chart or one icon.
- Formatting money inline instead of `formatCents` — the float bug is easy to reintroduce.
- A hard-coded hex colour that silently stops matching the theme.
