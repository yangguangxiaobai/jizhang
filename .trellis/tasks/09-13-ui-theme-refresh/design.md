# Design: Warm, Layered Accounting Theme

## Status and Change Boundary

Implementation approved on 2026-09-13 after the user reviewed the final visual plan.

The smallest gap is visual: preset changes currently recolor controls while leaving the page and equally weighted cards essentially unchanged. The behavior lives in `src/styles/main.css` and the presentation portions of the shell/dashboard/settings, not in stores or server accounting code. Keep those data paths intact.

## Visual Direction

A warm, quiet canvas with a deep-sea-blue balance card, clear typography, and restrained warm line decoration. Use solid surfaces rather than text-bearing gradients so contrast is measurable. Numbers take priority over decoration.

### Candidate palette

Values are recorded in `research/candidate-contrast.json` and demonstrated by `research/theme-concept.html`. Existing accent and semantic ladders are retained.

| Preset | Light page | Light balance card | Dark page | Dark balance card |
|---|---|---|---|---|
| Titanium / 钛蓝 | `#f7f5f0` | `#244d60` | `#131c22` | `#234353` |
| Forest / 森林绿 | `#f2f5ef` | `#294d3e` | `#151d18` | `#264737` |
| Mono / 极简黑白 | `#f4f3f1` | `#30343a` | `#17191d` | `#32373f` |

Keep `--surface` at `#ffffff` / `#1e2127` and existing foreground/muted/semantic colors. This limits global compatibility risk and preserves category-palette contrast on its actual surface. The background changes still give secondary pages the new atmosphere without changing their layout.

Token additions must have actual users:

| Token family | Consumer and contract |
|---|---|
| `--surface-soft` | Quiet budget/appearance surfaces; verify every text color used on them. |
| `--hero` / `--on-hero` | Balance-card background and primary text; independent of `--accent` because dark-mode accent is intentionally light. |
| `--hero-muted` | Secondary account labels on the balance card; no reduced text opacity. |
| `--hero-danger` | Signed negative/debt figures on the balance card; normal `--danger` remains for ordinary surfaces. |
| `--hero-decor` | Small decorative wallet-glyph detail outside numeric content; neutral in mono. |
| `--radius-card` / `--radius-control` | Consistent shapes in the changed views; retain the existing two elevation and motion ladders. |

Candidate hero text is white, secondary text `#d8e5e9`, and negative text `#ffd1ca`. The 138-pair candidate check includes the old semantic colors on new page/soft surfaces plus hero pairs; all pass, with minimum 4.5283:1. Production measurements remain mandatory, especially the near-floor warning/page pair in light mono.

### Intended guideline change

The current rule in `scripts/check-color.mjs:64-65,228-240` and `.trellis/spec/frontend/color-guidelines.md` permits only the accent triple per preset. Deliberately extend that allowlist to the needed page/soft/hero presentation tokens. Keep the common semantic/category ladders excluded. Do not replace this with unrestricted overrides or reduce a contrast threshold.

Keep complete light/dark/system/explicit selector coverage and the duplicate-block parity checks. Add the new text and meaningful-graphic pairs to the audit; decorative lines are not control boundaries and need no invented contrast claim.

## Screen Treatment

### Shared shell

- Keep the current six destinations, order, labels, route metadata, and 40rem content boundary.
- Replace emoji with one small, typed, local `AppIcon.vue` SVG component; inherit `currentColor`. Icons are decorative beside visible text, not replacement accessible names.
- Give the active destination a tinted shape plus text-weight distinction. Emphasize the existing fourth “记一笔” destination without repositioning it or adding a floating overlay.
- Preserve sticky bars, safe-area padding, keyboard focus, >=44px targets, and the existing route-arrival / reduced-motion behavior. No theme-wide color transitions.

### Dashboard

- Balance card: opaque themed surface, clearly dominant tabular amount, visible account breakdown, and existing transfer action. Keep debt breakdown and negative values; do not hard-code concept data.
- Monthly summary: separate surface and heading, three aligned figures. Never merge monthly flow with the account-stock total.
- Budget/details: quieter surface, normal readable labels, existing progress/word-based warnings. Pending confirmations remain prominent and conditional.
- Recent transactions: clearer spacing and separators, unchanged row actions, amount signs, refund behavior, and empty-state instructions.
- Do not re-derive totals, change fetching, or extract data logic during this presentation work. Preserve conditional rendering for partial/error states. Amounts may wrap responsively but must not be clipped, truncated, or rounded to fit.

### Appearance settings

- Keep the existing three display-mode controls and their setters.
- Replace plain preset segments with labeled preview buttons: a miniature page/card swatch, current labels, and a selected outline/checkmark. Preserve `aria-pressed`, the group semantics, and exact accessible names “钛蓝”, “森林绿”, “极简黑白” used by existing browser tests.
- Swatches derive from canonical CSS preset values, not a second hard-coded JS palette. Keep any preview-only token scope explicit so values cannot leak into actual financial content.
- Retain account, data-management, budget-cycle, password, and about sections. The concept only shows the viewport, not a decision to remove those controls.

## File Boundary

| Planned path | Why needed |
|---|---|
| `packages/web/src/styles/main.css` | Canonical palette, surface/hero/shape tokens; preserve existing motion rules. |
| `packages/web/src/views/AppShell.vue` | Shell treatment and navigation icons, no route changes. |
| `packages/web/src/views/DashboardView.vue` | Visual hierarchy and correctly paired hero text; existing data logic retained. |
| `packages/web/src/views/SettingsView.vue` | Accessible preset previews and appearance spacing. |
| `packages/web/src/components/AppIcon.vue` (new) | Reusable presentation-only SVG vocabulary for the changed screens. |
| `packages/web/vite.config.ts` | Default manifest background must match the updated light page. |
| `packages/web/scripts/check-color.mjs` | Explicit preset allowlist and new contrast-pair coverage. |
| `packages/web/e2e/theme.spec.mjs` (new) | Isolated theme/layout/compatibility regressions, reusing existing fixtures and color math. |
| `packages/server/scripts/e2e-pwa.mjs` | Update the default-background assertion at line 50, not server behavior. |
| `.trellis/spec/frontend/color-guidelines.md` and `index.md` | Document the intentionally broader preset contract and measured surfaces. |

No expected changes to `theme-init.js`, `useTheme.ts`, `index.html`, the icon generator, routing, stores, APIs, shared accounting, or database files. The existing surface-colored browser metadata remains correct because surfaces are unchanged. If implementation reveals a larger necessary boundary, report it before widening scope.

## Data Flow and Compatibility

Settings button -> existing setter -> existing storage key and root attributes -> CSS palette. Dashboard stores/API -> existing computed/display helpers -> presentational markup. There is no new domain flow.

The unchanged `theme-init.js` still applies theme/preset attributes before the body exists. The unchanged `useTheme.ts` retains OS following and syncs browser chrome to the surface. Preserve preset IDs so existing installations need no migration. The PWA manifest remains the default light launch palette rather than pretending to personalize static install metadata.

## Verification and Risks

- The standalone concept is not a Vue implementation and does not prove production accessibility, finances, caching, or iOS behavior. Screenshot data is illustrative.
- Global background changes reach login, transaction, budget, statistics, and form pages; include them in contrast/overflow smoke checks even though their layouts are out of scope.
- Do not run legacy `render-theme.mjs` / `render-color.mjs` against the user's ledger: their startup code resets/seeds the configured container. Prefer `e2e/fixtures.mjs` temporary databases/listeners for this task.
- Local Chrome is available. Downloaded Playwright browser engines were not present during planning; WebKit execution may need a separate approved dependency download. Chrome is not a substitute for an iPhone Safari check.
- Keep the existing PWA cache policy unchanged. Installed-iPhone safe areas, standalone launch, and keyboard behavior remain device checks when hardware is available.
- Rollback is a reviewable revert of this task's presentation, palette, assertions, and spec edits; no data, key, or schema migration is involved. Never use a workspace-wide reset.

## Implemented Refinements

To keep the unchanged 60KiB CSS gate, the implemented variant uses a warm wallet glyph
rather than ornamental rings, and a selected glyph pill plus text weight rather than a
duplicate underline. `theme-card`/`theme-button` are opt-in shared styles only for the
refreshed views. The scope also includes the necessary legacy color/motion probe updates,
the shared `e2e/helpers.mjs` extraction plus its import in `iphone.spec.mjs`, and matching
motion-spec text. No extra product page, domain behavior, or public interface was added.

Validation and known baseline failures are recorded in `verification.md`.
