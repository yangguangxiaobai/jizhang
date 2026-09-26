# Full Frontend UI Redesign — Implementation Plan

## Preconditions

- Use the reviewed full-scope PRD and this design file.
- Ardot file `729347012405452` is available and contains the design system, all 20 page artboards, shared form/modal states, empty/offline states, and a desktop-width example.
- Preserve unrelated working-tree files and keep the design work scoped to `packages/web` plus task documentation.

## Ordered work

1. **Page and state inventory** — complete
   - Map each of the 20 unique views to routes, current actions, validation, and loading/empty/error/pending states.
   - Record the shared modal/component dependencies and representative long-value cases.

2. **Ardot design system and screens** — complete
   - Create reusable tokens and component examples from the approved warm/deep-blue theme.
   - Design mobile artboards for all 20 unique views and the shared import/detail/confirmation surfaces.
   - Add representative wide-screen layouts and show how each page responds within the existing shell model.
   - Review all six theme combinations for text and meaningful-graphic contrast.

3. **Shared frontend foundation** — complete
   - Refine the shell, page headings, spacing, buttons, fields, cards, notices, modal framing, and shared list/chart patterns.
   - Preserve the six destinations, focus semantics, route titles, safe areas, and reduced-motion contract.
   - Consolidate duplicated declarations as needed to stay within the user-approved 112 KiB CSS limit.

4. **Page implementation** — complete
   - Access and daily use: Login, Dashboard, Transactions, TransactionEdit, Assistant, and transaction detail/trash surfaces.
   - Budget and movement: Budget, SalaryEntry, SalaryRecords, Templates, Transfers, and TransferEdit.
   - Scheduled bills and insights: RecurringRules, RecurringRuleEdit, PendingOccurrences, Stats, and charts.
   - Management and preferences: Manage, Data, Settings, AiProviderSettings, AI settings, and import surfaces.
   - Match the approved Ardot screens while preserving each view's current stores, API calls, and business behavior.

5. **Responsive and theme pass** — complete
   - Check 375 / 390 / 430 px and desktop layouts for overflow, clipped money, long names, and reachable actions.
   - Inspect light/dark and titanium/forest/mono combinations, keyboard focus, safe areas, and reduced motion.

6. **Build verification and handoff** — complete
   - Run frontend lint and typecheck, then the production PWA build to enforce existing mobile, motion, color, manifest, and bundle gates.
   - Review the final code diff against every Ardot artboard and report any manual device checks separately.
   - Add no new automated tests unless the user requests them.

## Validation commands

```text
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @jizhang/web run build
JIZHANG_E2E_CHANNEL=chrome node node_modules/@playwright/test/cli.js test --config packages/web/playwright.config.mjs --project=chromium-iphone
git diff --check
```

## Scope and rollback points

- Expected code boundary: `packages/web/src/styles/main.css`, all 20 unique view SFCs, the shared presentation components used by those views, and only the minimal build/style audit files needed to express the approved design.
- Do not edit API, service, store, database schema, accounting arithmetic, or AI-provider behavior. Existing route contracts are unchanged; the item-close UI route is a page-level presentation detail.
- Land work in reviewable slices: shared tokens/shell first, then page groups. If a shared primitive changes behavior outside its visual role, revert that primitive before proceeding.
- Commit and deployment were explicitly authorized by the user after implementation review; the deployed image and health check are recorded after handoff.

## Verification result

- `pnpm -r run lint` passed.
- `pnpm --filter @jizhang/web run build` passed, including typecheck, mobile, motion, color, and PWA checks.
- All 17 Chromium iPhone-viewport Playwright tests passed. The Playwright-downloaded browser binary is unavailable on this host, so the suite used installed Chrome; no physical iPhone/WebKit run was performed.
- Final aggregate bundle: JavaScript 351,393 B (343.16 KiB raw); CSS 109,813 B (107.24 KiB raw, 29,357 B / 28.67 KiB gzip). Both raw totals are under the approved 352 / 112 KiB caps.
- Ardot screenshot review covered the design system, representative core screens, key states, and wide-screen example. Full screenshot files are under `research/729347012405452/`.
- No server API, schema, store, or accounting calculation changed. The item close screen is UI-only and writes no ledger rows.
