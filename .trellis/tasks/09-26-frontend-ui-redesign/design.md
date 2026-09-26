# Full Frontend UI Redesign — Design

## Boundary

The visual gap spans the complete PWA. The page data, accounting rules, route guards, validation, and write-confirmation contracts already exist and remain unchanged. Work is confined to presentation, reusable UI composition, the dedicated item lifecycle close screen, and design-specific checks required to keep the current theme and PWA budgets valid.

## Design source

- Use the active Ardot document as the source of truth for page layouts and reusable components. File id: `729347012405452`.
- The `00 设计系统` page contains palette, typography, amount, card, button, field, notice, confirmation-card, and six-tab examples. `Page 1` contains the 20 mobile page artboards and transaction-detail modal. `02 关键状态` contains category/template editing, platform-import preview, empty/offline states, and a wide-screen example.
- Carry forward the approved warm off-white / deep-sea-blue visual direction, existing semantic color ladder, and titanium / forest / mono presets.
- Create a shared component and token page, then organize mobile artboards by workflow: access and shell; daily ledger; budget and income; recurring payments; statistics and AI; settings and data maintenance.
- Add a wide-screen frame for representative shell, dashboard, ledger, assistant, and settings layouts. Other pages stay responsive within the existing 40rem content boundary.

## Frontend architecture

- `packages/web/src/styles/main.css` remains the canonical source for palette, spacing, typography, surface, radius, focus, and motion tokens.
- `AppShell.vue` owns the shared page frame, top bar, offline/install notices, and six-item bottom navigation.
- Existing views continue to own route-specific data loading and actions. Keep stores and typed API responses as the only data sources.
- Shared UI components own only presentation. Extend existing components before adding new abstractions; do not introduce a design framework or runtime dependency.
- Preserve the existing theme selectors and preference keys so each screen works in system/light/dark mode and all three accent presets.

## Page coverage

The source-backed route and state checklist is maintained in `research/screen-inventory.md`.

| Workflow | Views and shared surfaces |
|---|---|
| Access and shell | Login, AppShell, OfflineBanner, InstallHint |
| Daily ledger | Dashboard, Transactions, TransactionEdit, TransactionDetailModal, Trash |
| Money movement | Transfers, TransferEdit |
| Budget and income | Budget, SalaryEntry, SalaryRecords, Templates |
| Scheduled bills | RecurringRules, RecurringRuleEdit, PendingOccurrences |
| Insights and AI | Stats, Assistant, AiProviderSettings, AiSettingsPanel, AiThinkingStatus |
| Data and preferences | Manage, Data, Settings, PlatformImportModal, PlatformImportRows |
| Shared visuals | AppIcon, DonutChart, BarChart, buttons, fields, cards, notices, empty/error/loading states |

Route aliases that render the same form view share a frame and show their existing new/edit title and state. The design should not collapse distinct current page functions into a single generic screen.

## Layout and interaction rules

- Use a consistent page heading, concise explanatory copy, and a clear primary action where the current flow has one.
- Keep long ledgers and management lists scannable, with amounts aligned and row actions discoverable without shrinking touch targets.
- Keep forms grouped by user intent, use full-width mobile controls, and place validation feedback next to its field or form action.
- Preserve visible confirmation summaries before any write. Import preview, row selection, category override, warning, and confirm/cancel steps remain explicit.
- Charts and totals keep their current server-provided values and semantics. Never truncate, round, or recompute figures to fit a visual layout.
- Preserve focus rings, semantic names, selected/disabled states, safe areas, and reduced-motion behavior.

## CSS and bundle constraint

At task start, the CSS was only 162 bytes under the 80 KiB PWA budget. The user explicitly approved raising the raw CSS ceiling to 112 KiB to preserve this Ardot design. Consolidate genuinely shared declarations into existing primitives and remove duplicate obsolete rules in touched views; keep CSS readable, report compressed size, and keep JavaScript below 352 KiB. Add no runtime package.

The implementation centralizes card elevation/radius, field/action radius, and tabular numeric figures in the existing global stylesheet. View-local styles continue to own layout, spacing, and financial-state colors while dropping duplicate corner-radius declarations.

## Data flow and compatibility

This is a view-layer redesign. API DTOs, Pinia stores, existing route names, route metadata, form submission behavior, money/date helpers, cache policy, database, and backend services stay unchanged. The item lifecycle has a dedicated UI route for its close screen; it uses the existing API contract and does not write bills. Theme preferences keep their current storage keys and apply before first paint.

## Risks and rollback

- Shared global styles can affect every route and all six theme palettes; review representative light/dark and preset combinations.
- Dense tables, chart labels, large/negative amounts, and import controls can overflow on narrow screens; the design includes their real states and long-value cases.
- The strict CSS cap can tempt unreadable minification. Prefer eliminating duplicated declarations and reusing semantic primitives.
- Roll back only the touched presentation files and design-specific checks; no data migration or server rollback is needed.
