# UI Theme Refresh

## Goal

Give the feature-complete accounting app a warm, distinctive, layered visual identity without changing its accounting behavior. Improve everyday readability, not decorative complexity.

## Background

The user reported that the current theme feels monotonous and, on 2026-09-13, approved creating this task and developing the proposed warm off-white / deep-sea-blue direction. The user subsequently approved the final visual plan ("可以"); implementation was authorized on 2026-09-13.

Confirmed repository facts:

| Fact | Evidence |
|---|---|
| Presets currently override only the three accent colors. | `packages/web/src/styles/main.css:281-340`; `packages/web/scripts/check-color.mjs:64-65,228-240` |
| Appearance already supports three theme preferences and three named presets. | `packages/web/src/composables/useTheme.ts:21-28`; `packages/web/src/views/SettingsView.vue:24-35,117-145` |
| The dashboard already separates account balances, monthly flows, pending confirmations, budget, and recent transactions. | `packages/web/src/views/DashboardView.vue:177-320` |
| Navigation already has six destinations, including a dedicated record-entry action. | `packages/web/src/views/AppShell.vue:48-104` |
| Global background changes also affect the PWA manifest and a served-manifest assertion. | `packages/web/vite.config.ts:55-56`; `packages/server/scripts/e2e-pwa.mjs:49-50` |
| Isolated browser tests already create a temporary ledger and HTTP listener. | `packages/web/e2e/fixtures.mjs:1-58` |

## Requirements

| ID | Required outcome |
|---|---|
| R1 | Extend the current theme system so each existing preset coordinates the page background, a quiet secondary surface, and the balance-card treatment. Keep the default titanium-blue identity. |
| R2 | On the dashboard, make the total balance the primary visual anchor, the monthly summary secondary, and budget/list details quieter. Preserve every current value, conditional state, and action. |
| R3 | Use consistent local SVG line icons in the shared shell, preserving all six destinations, their order, and labels. Emphasize the existing record-entry action without adding an overlay or new navigation model. |
| R4 | Improve appearance settings with labeled visual preset previews and an explicit selected state. Preserve the current preference model and all non-appearance settings/actions. |
| R5 | Maintain financial-state meaning, text legibility, mobile accessibility, safe areas, and reduced-motion behavior across light/dark and all three presets. |
| R6 | Verify the global-token effects on other existing pages and keep launch metadata in sync. Do not weaken existing quality gates to accommodate a visual design. |

## Compatibility and Constraints

- Existing `jizhang.theme` / `jizhang.accent` keys and values remain unchanged; system following, pre-body attribute application, and reload persistence remain intact.
- Keep shared card/header surfaces at their existing light/dark values. Preserve the app icon and the default `#2f6f8f` accent; update only the necessary PWA background references.
- Preserve existing data sources, numeric formatting, money signs, refund meaning, account/debt visibility, and navigation behavior. No new client-side accounting calculations.
- Presets may change presentation colors, but not shared income/success, warning, danger, or category semantics. Text on the new dark balance card needs its own measured foreground colors.
- No external fonts, raster decoration downloads, UI/icon framework, theme store, or animation system. Extend existing tokens and local components.
- Text >=4.5:1; meaningful graphics >=3:1. State remains understandable without color. Controls >=44x44 CSS px; inputs/selects >=16px; retain zoom, safe areas, and reduced motion.

## Acceptance Criteria

- [x] AC1 (R1/R2): The dashboard shows three deliberate visual levels: themed balance card, monthly summary, and detail/budget cards; stock and monthly-flow figures remain separate.
- [x] AC2 (R1/R4): Titanium, forest, and mono each visibly change both the page atmosphere and balance card in light and dark modes, with clearly labeled preview selections.
- [x] AC3 (R2/R3/R4): Existing loading/error/empty/debt/pending/budget states, all six navigation routes, transfer and transaction actions, and all non-appearance settings remain available and correct.
- [x] AC4 (R4): Saved preferences apply before body paint, survive reload, and follow OS changes only when system mode is selected; old saved values require no migration.
- [x] AC5 (R5): All used token pairs and rendered key text/graphics meet the contrast floors in all six resolved palettes; negative balance-card amounts remain legible and signed.
- [x] AC6 (R5): No horizontal overflow at 375/390/430 CSS px or at a desktop viewport. Long account names, large/negative amounts, and enlarged text remain readable; touch targets, safe areas, focus, and reduced motion are retained.
- [ ] AC7 (R6): Typecheck, lint, tests, mobile/motion/color/PWA build checks, and isolated browser regressions pass. Unavailable real-iPhone or WebKit checks are explicitly reported, not counted as passes.
- [x] AC8 (R1-R6): No production backend/API/schema/store changes, real-ledger mutations, preference-key migrations, or new runtime dependencies.

## Out of Scope

New accounting features, new routes, data migrations, preset removal, redesigning the layouts of every secondary page, a desktop sidebar, app-icon rebranding, sweeping component refactoring, new motion effects, and changes to deployment topology.

## Planning Artifacts and Review Status

- `design.md`: source-backed boundaries, palette, screen treatment, compatibility, and risks.
- `implement.md`: ordered work, validation commands, and rollback boundaries.
- `research/theme-concept.html`: standalone interactive visual concept. All amounts are illustrative; it never connects to the app or changes saved settings.
- `research/candidate-contrast.json`: 138 candidate text-pair calculations pass >=4.5:1; worst is 4.5283:1. This is not production/browser contrast verification.
- `research/prototype-check.json`: concept-only checks pass for six palettes, display-mode controls, and 375/390/430/1420px layouts.

Requirements have converged and the PRD has been rewritten into this final structure. The user approved this final plan in a subsequent message. Task status is now `in_progress`; implementation stays within the reviewed boundary.

## Implementation Handoff

The approved implementation is delivered and ready for visual review. See `verification.md`
and `research/verification.json` for exact evidence. AC7 remains unchecked: the full WebKit
suite has two pre-existing server-restart/outage page-error failures, reproduced on the
unchanged HEAD baseline; the new theme suite passes in both engines. Physical-device
verification is still a manual follow-up. No real ledger changes, commit, or archive were made.
