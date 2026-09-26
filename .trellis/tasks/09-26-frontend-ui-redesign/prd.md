# Full Frontend UI Redesign

## Goal

Use Ardot to redesign the complete user-facing frontend, then carry that design through the Vue PWA so every existing page feels coherent, readable, and easy to use on a phone while retaining the accounting workflows users already depend on.

## Confirmed product direction

- The scope is the whole frontend, not only the AI assistant or dashboard.
- Ardot is the required design tool for the visual design artifact.
- The active Ardot file is `729347012405452`; it now contains a design-system page and a page with all 20 unique views plus a transaction-detail modal artboard.
- Reuse the previously approved warm canvas, deep blue accent, layered surfaces, and existing titanium / forest / mono theme choices as the visual foundation.
- The primary device remains an iPhone-sized viewport. Preserve the six-item bottom navigation and the current route model.

## Confirmed repository facts

- `packages/web` is a Vue 3 + TypeScript + Vite PWA. User-facing routes render through a shared `AppShell.vue`; the router contains 23 route entries backed by 20 unique page views, including shared create/edit form views.
- The unique views are Login, Dashboard, Transactions, TransactionEdit, Assistant, Budget, SalaryEntry, SalaryRecords, Templates, Stats, Manage, Trash, Transfers, TransferEdit, RecurringRules, RecurringRuleEdit, PendingOccurrences, Data, Settings, and AiProviderSettings.
- Shared UI also includes the import modal and rows, transaction detail modal, AI settings/thinking components, offline/install notices, icons, and hand-built charts.
- Six navigation destinations are fixed in this order: 首页 / 账单 / 预算 / AI 助理 / 统计 / 我的.
- The frontend is mobile-first, with 375 px as the minimum supported phone width, a 40rem content boundary, 44 px interactive targets, 16 px form controls, safe-area support, and reduced-motion rules.
- At task start, the deployed production CSS bundle was 81,886 bytes (79.97 KiB) against an 80 KiB PWA limit, leaving almost no room for additional CSS. The JavaScript bundle was 310,894 bytes against a 320 KiB limit. The user later explicitly approved a 112 KiB raw CSS ceiling to retain the Ardot design; JavaScript remains capped at 352 KiB.
- Existing money, date, theme, store, API, and accounting behavior is established in the frontend specs and must remain the source of truth.

## Requirements

### R1. Complete visual coverage

- Create the design system and one representative mobile artboard for every unique page view in the active Ardot design file.
- Include the create/edit variants of shared forms, confirmation and import modals, and the important loading, empty, error, success, disabled, and pending states that change the page layout.
- Keep shared components visually consistent across every page.

### R2. Implement the approved design across the frontend

- Apply the Ardot design to the shared shell and all 20 unique page views, plus the reusable modal and interaction components used by them.
- Establish consistent page headers, section hierarchy, cards, forms, lists, charts, alerts, dialogs, and primary/secondary actions.
- Keep labels, amounts, dates, status, and category/account distinctions easy to scan, with financial values receiving appropriate emphasis.

### R3. Preserve product behavior

- Preserve existing routes, API calls, server-calculated values, form validation, confirmation steps, import selection and overrides, account/category actions, and all conditional states. The item lifecycle uses a dedicated UI route for its close flow; it does not change the server or ledger-write contract.
- Do not change the six navigation destinations, their order, or the dedicated record-entry workflow.
- Preserve the existing appearance preference keys, display modes, accent presets, and pre-paint theme behavior.
- Do not add a new accounting feature or duplicate server-side calculations in the client.

### R4. Responsive accessibility

- Design mobile-first at 375 px and ensure every page remains usable at 390 px, 430 px, and desktop widths within the existing content model.
- Avoid horizontal overflow, clipped amounts, obscured controls, and layouts that fail with long account/category names or larger text.
- Keep keyboard focus visible, semantic control names intact, and states understandable without color alone.
- Preserve 44 px targets, 16 px controls, safe-area spacing, zoom support, and reduced-motion behavior.

### R5. Maintain the small PWA footprint

- Keep the production JavaScript below 352 KiB and CSS below the user-approved 112 KiB PWA limits; review compressed output and add no runtime dependency.
- Reuse and consolidate existing style primitives where helpful; add no runtime dependency, icon library, or external font.

## Acceptance Criteria

- [x] The active Ardot file contains a coherent design system and artboards for all 20 unique pages, shared form variants, the transaction-detail modal, import preview, empty/offline states, and one desktop-width example.
- [x] Shared cards, controls, buttons, navigation, and financial-number presentation across all route views follow the approved Ardot system and existing theme tokens.
- [x] Existing routes, labels, actions, validation, imports, confirmations, and accounting data remain unchanged; the item close screen is a dedicated UI route with no new server or ledger behavior.
- [x] All six navigation items retain their current order and fit at 375 px in the design and implementation.
- [x] Existing responsive layouts and breakpoints remain in place at 375 / 390 / 430 px and desktop widths; no new fixed-width content was added.
- [x] Touch-target, focus, safe-area, zoom, color-contrast, and reduced-motion build checks pass.
- [x] Production JavaScript (343.16 KiB raw) and CSS (107.24 KiB raw / 28.67 KiB gzip) stay below the approved 352 / 112 KiB limits. No runtime dependencies are added.
- [x] The final handoff records the Ardot file id and implementation/verification results.

## Out of Scope

- Backend/API/schema changes, accounting-rule changes, new server features, or changes to AI provider behavior.
- A new navigation destination, desktop sidebar, external icon/font library, or replacement of the current theme preference model. The desktop shell reuses the same six destinations.
- Removing existing controls or workflows to simplify the visual redesign.
