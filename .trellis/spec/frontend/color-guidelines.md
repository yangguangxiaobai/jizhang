# Colour Guidelines — Frontend

> The tokens live in `styles/main.css`; the category palette lives in
> `@jizhang/shared`'s `palette.ts`; both are audited by `scripts/check-color.mjs` on every
> build and measured in isolated browsers by `e2e/theme.spec.mjs` (plus the older
> seeded-container `scripts/render-color.mjs`).

---

## Why there is a document for this

A wrong colour looks exactly like a right one in a diff. `#6b7280` and `#5f6b7a` are one
line apart and 0.4:1 apart on the page; `var(--fg)` with no definition is a valid declaration
that paints nothing; a manifest that says `#2f6f8f` while the stylesheet says `#2563eb` is
two correct-looking files. Every defect this system has had was of that shape, and none was
found by reading. So the rules below are written to be *checked*: seven of them statically,
the rest against rendered pixels.

---

## The ladder

```
neutrals   --bg  --surface  --surface-soft  --border  --fg  --muted
hero       --hero  --on-hero  --hero-muted  --hero-danger  --hero-decor
hues       accent  ok  warning  danger
rungs      --X        the solid: text, borders, fills
           --on-X     text that sits ON the solid (accent, ok, warning)
           --X-subtle a tint for a callout, with --X as the text on it
palette    --cat-1 … --cat-12
```

Every hue has all three rungs except `danger`, which has no `--on-danger`: nothing puts text
on a solid danger background (destructive buttons are outlined by design, so they are named
in words rather than only in colour). A token with no user is a definition that reads as a
capability, and the audit fails one — add it *with* its first user.

### The floors, and where they are measured

| Pair | Floor | Why |
|---|---|---|
| any solid as text on `--bg` / `--surface` / `--surface-soft` | 4.5:1 | WCAG AA; nothing in the app is "large text" |
| `--on-hero`, `--hero-muted`, `--hero-danger` on `--hero` | 4.5:1 | Balance-card text, including negative amounts |
| `--on-X` on `--X` | 4.5:1 | button labels are 16px bold, which is still normal text |
| `--X` on `--X-subtle` | 4.5:1 | the notice text |
| a progress fill against its track (`--bg`) | 3:1 | WCAG 1.4.11, meaningful graphics |
| a category colour against `--surface` | 3:1 | slices, dots, glyph backgrounds |

Measured for every theme × preset (2 × 3 = 6 palettes) by `check-color.mjs`, and again from
the rendered pages by `e2e/theme.spec.mjs`, which checks six screens under all six palettes,
including the new soft/hero surfaces. The legacy container suite covers four screens.

**Not claimed:** `--border` against `--surface` is ~1.3:1 in light mode. It outlines cards and
inputs decoratively; a 3:1 control boundary would need a second, darker border token applied
to every form control, and that is a separate decision. The audit prints the number so it
cannot be forgotten.

### The values worth knowing why

- `--accent` (钛蓝) is `#2f6f8f`, the colour of the **app icon**. The stylesheet had drifted to
  `#2563eb` while the icon, the manifest and the `theme-color` all still said `#2f6f8f`; the
  audit now pins the icon generator's constant to the token.
- `--muted` is `#5f6b7a`, not the usual grey-500: `#6b7280` measured **4.45:1** on `--bg`, and
  muted labels sit directly on the page in the list views.
- `--warning` is a burnt orange (`#b45309`), not a yellow, because it has to be read as a
  *word* on white. The dark value (`#fbbf24`) can afford to be amber.
- The dark tints (`--X-subtle`) are dark washes of the hue, not pastels: a pastel on
  `#1e2127` is a glowing rectangle.

---

## Presets

`data-accent` on `<html>`: absent = 钛蓝, `forest` = 森林绿, `mono` = 极简黑白. A preset
overrides exactly **the accent triple plus `--bg`, `--surface-soft`, `--hero` and
`--hero-decor`**. This allowlist is enforced by `check-color.mjs`. Ordinary `--surface` and
all financial-state/category colors stay shared: a preset changes atmosphere, not meaning.

The selectors are written with `:root` on purpose — `:root[data-accent='forest']` is (0,2,0)
and the dark variants are (0,3,0) — so specificity, not source order, decides. A bare
`[data-accent='forest']` would be (0,1,0) and would lose to the system-dark rule: a green phone
in the dark would silently show the blue.

Mono is the theme's own foreground (`#1c1f23` light, `#e8eaed` dark). Every accent user —
buttons, the active tab, the focus ring, the progress fill, the expense bars, the sparkline —
becomes black-on-white or white-on-black without any component knowing.

The preference is `localStorage['jizhang.accent']`, applied by `theme-init.js` before first
paint and mirrored by `useTheme.ts`. The keys and the accepted values are restated in both
files, and the audit fails if they disagree.

---

## Balance cards, previews, and opt-in surfaces

The balance card is dark in both display modes. It uses `--hero` rather than `--accent`:
the dark-mode accent is intentionally light, so reusing it would invert this hierarchy.
Primary labels use `--on-hero`, secondary/account labels `--hero-muted`, and signed negative
figures `--hero-danger`. Do not put the ordinary light-mode `--danger` on this dark surface.
The wallet glyph uses `--hero-decor`; it is decorative beside a visible label, and neutral in mono.

`SettingsView` renders decorative SVG `.theme-preview` children with `data-accent`. The global
base and preset rules use comma-separated selectors so those children get the **same literal
definitions** as the root. There is no palette array in JavaScript. Base, explicit light,
system dark, and explicit dark all cover the previews; static selector checks and a browser
comparison of each SVG fill against the corresponding real page protect this wiring.

Never put `.theme-preview` on the selection button or its text: an inactive miniature must
not change the real button's text, focus ring, selected state, or descendant controls.
Preset buttons retain the exact accessible names 钛蓝 / 森林绿 / 极简黑白, descriptions, and
`aria-pressed`. Automation should select those names/groups rather than assume every
appearance control is a `.segmented button`.

`.theme-card` and `.theme-button` are opt-in presentation primitives used by the refreshed
dashboard and settings. They share the card/control radius tokens and ordinary surfaces;
scoped variants own hero, soft-surface, ghost, and selected states. Do not style a bare global
`.card` or `button` to spread a local redesign into unrelated views. Large amounts and account
names wrap without losing precision or ellipsizing; the 375px / 200%-text browser check
covers the server-valid 40-character account-name limit.

---

## The four structural rules

### 1. No colour literal in a component

Every colour in a `<style>` block is a `var(--…)`. A hex, `rgb()` or `hsl()` in a component
fails the build. The only literal colours in the app are the token definitions in
`main.css`, and the one sanctioned exception is a category colour from the database applied
**inline in a template** (never in a stylesheet) — see below for why even that is usually a
token.

The fallback form `var(--ok, #3f9e6a)` counts as a literal. It existed because `--ok` once did
not; now that it does, the fallback is dead code that would silently take over if the token
were ever renamed.

### 2. Every token referenced is defined, and every token defined is referenced

The check that would have caught `--fg` and `--ok` being used in every view and defined in
none. It is also what removed `--text`, which was defined "for compatibility" and referenced
nowhere. The same rule as the motion tokens.

### 3. The duplicated theme blocks are identical

`:root` and `[data-theme='light']` restate the same values; so do the system-dark and
explicit-dark blocks, and each preset's two dark blocks. The duplication is required by the
cascade (an explicit choice has to beat the media query in the same specificity band), and it
is a drift hazard, so the audit diffs them token by token. Every theme must also define the
same *set* of tokens: a rung present in light and missing in dark is exactly the `--ok` bug
again.

### 4. The pieces outside the stylesheet agree with it

The manifest's `background_color` is the light `--bg` and its `theme_color` is the light
`--surface`; the two `theme-color` metas in `index.html` are the light and dark surfaces; the
icon generator's accent is the light `--accent`. `useTheme.ts` keeps the metas on the surface
in effect after a theme change.

**Why the surface and not the accent for `theme-color`:** the status bar sits directly above
`.topbar`, which is `--surface`. Painting it the accent puts a coloured strip over a white bar,
and in the dark theme the accent is a light blue over `#1e2127`, which is worse. The earlier
`e2e-pwa` assertion pinned the accent; it now pins the surface.

---

## The category palette

Twelve fixed slots in a fixed order, `CATEGORY_PALETTE` in `@jizhang/shared` and
`--cat-1` … `--cat-12` in `main.css`. The **light values are the palette** — they are what
`categories.color` stores, as ARGB — and the dark values are the same hues re-stepped for the
dark surface. `categoryCssColor(argb)` returns `var(--cat-N)` for a palette colour and the raw
hex for anything else, so a custom colour still passes through.

### Legacy integers are recognised, never migrated

Seeding is `ON CONFLICT DO NOTHING`, so an existing database keeps the reference app's
integers. `LEGACY_CATEGORY_PALETTE` lists the old twelve by slot; an old 餐饮 (`#b8786f`,
slot 1) renders as the new slot 1 with no write. This is why the two lists must never share a
value — a lookup would be ambiguous — and the unit test asserts they do not.

### The order is validated, not chosen

The slot order is the colour-vision-deficiency mechanism: adjacent slots are what the seed
assigns to adjacent categories, so the audit checks every adjacent pair under simulated
protanopia and deuteranopia (Machado 2009, OKLab ΔE ≥ 6, target 8) and for full-colour vision
(ΔE ≥ 15), plus the OKLCH lightness band and chroma floor per theme and 3:1 against the
surface. Reordering the slots changes which categories can be confused; do it in both files
and re-run the audit.

The six seeded expense slots share one donut ordered by *amount*, so any two can touch. Six
colours cannot all clear the adjacent floors pairwise; the worst of the fifteen pairs is
printed, and the remainder is carried by the two secondary encodings the donut always has: a
legend naming every slice, and a surface-coloured gap between slices (`stroke: var(--surface)`
on `.slice`).

### `fill` is a style, not an attribute

`<path fill="var(--cat-1)">` paints **black**: an SVG presentation attribute is parsed as an
attribute value, not as CSS, so `var()` is invalid there. `:style="{ fill: … }"` goes through
the CSS parser. `DonutChart.vue` uses the style form, and `render-color.mjs` asserts no slice
is black in the dark theme.

---

## Envelope tones

`utils/budget-tone.ts` draws one line at 80%: below it a bar is the accent, from 80% to 100%
it is `--warning`, above 100% it is `--danger`. The threshold is a design constant — the one
number on the client that is not fetched — and is allowed because it is not a figure: the
spent and budget amounts still come from the server's module view.

The tone is always paired with a word ("接近上限", "已超支") on the same row, and the
budget page and the dashboard both count the tiers in a `.notice`. State is never carried by
colour alone.

---

## Callouts

`.notice` + `.notice-{accent|ok|warning|danger}` in `main.css` is the common callout use of the
`--X-subtle` rung (the active navigation pill also uses the accent tint): tint background, 4px edge and the hue as text. Views add the class
and keep their own margins; none restates the colours. Users: the history-cycle note (accent),
the import result (ok), the near-limit count (warning), the overspend count (danger).

---

## What the browser suite adds

Prefer `e2e/theme.spec.mjs` with `e2e/fixtures.mjs`: temporary ledger and HTTP listener,
no real data or container reset. It checks preset persistence, before-body attributes,
system/explicit choices, disabled-storage fallback, contrast, navigation, and large-text
layouts. Only its HTTP-fault simulation blocks service workers: Playwright page routes
cannot intercept fetches owned by a worker. Other theme tests leave the real worker enabled.

The older `render-color.mjs` (on `lib/browser.mjs`) also:


- switches presets through the real settings control, asserts the attribute, the persisted
  value, the painted button, and — via a `MutationObserver` installed at document start —
  that `theme-init.js` set `data-accent` while `<body>` was still null;
- samples every visible text element on `/`, `/transactions`, `/budget`, `/stats` under all
  six theme × preset combinations and asserts ≥ 4.5:1;
- seeds one category with a legacy integer and one with a custom colour, and asserts each
  donut slice is painted with its dark-variant token, the custom colour passes through, and
  nothing is black;
- seeds envelopes at 85% and 120% and asserts the fills equal `--warning` / `--danger`, the
  words appear, and the notices are the tints with the hue as text.

**Safety:** legacy rendering suites may reset/seed their configured container. Run them only
against a disposable instance, never the user's ledger.

---

**Language**: documentation in English; UI copy in Chinese.
