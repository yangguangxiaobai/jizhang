# Implementation Plan: UI Theme Refresh

## Execution Gate

**Authorized on 2026-09-13.** The user approved the final plan with "可以". The task is now `in_progress`, started with:

~~~powershell
python ./.trellis/scripts/task.py start .trellis/tasks/09-13-ui-theme-refresh
~~~

Execution will be single-agent and inline; no sub-agent dispatch or JSONL injection is needed. Re-read the current artifacts and run `trellis-before-dev` before product edits. Do not alter unrelated untracked Trellis files or the previous iPhone-delivery task.

## Ordered Work

### 1. Establish a safe baseline

- [x] Record current git status and the narrow path list in `design.md`.
- [x] Read frontend component/color/motion/state/quality guidelines; read the applicable backend/script guidelines before changing the served-PWA test assertion.
- [x] Run baseline typecheck/lint/build checks and identify pre-existing failures without “fixing” unrelated work.
- [x] Capture isolated baseline screenshots for dashboard/settings and representative secondary pages, never screenshots of real financial data.

### 2. Extend the canonical theme

- [x] Add the actually used soft-surface/hero/shape tokens, retaining semantic ladders, icon identity, and ordinary light/dark surfaces.
- [x] Apply the three full preset treatments in every relevant explicit/system light/dark selector.
- [x] Update the color-audit allowlist, parity coverage, and text/graphic pairs alongside the new tokens. Never disable existing guards or lower floors.
- [x] Synchronize only the changed manifest background and the served-manifest test expectation; confirm unchanged metas/icon accent still match.
- [x] Run mobile/motion/color checks after this slice.

### 3. Implement the shell and dashboard presentation

- [x] Add the small, typed SVG icon component; keep icons decorative wherever text labels already name a control.
- [x] Restyle shell/nav without changing destinations, order, focus behavior, safe areas, or motion.
- [x] Restyle dashboard balance/monthly/budget/list sections, preserving bindings, fetch behavior, accounting helpers, empty/error/debt/pending cases, and every action.
- [x] Pair dark hero text and negative figures with their own measured tokens. Keep account names and monetary precision readable at narrow widths and enlarged text.
- [x] Preserve selectors used by existing tests unless a necessary structural change is explicitly reflected in the relevant assertions.

### 4. Implement appearance previews

- [x] Use the existing theme state/setters and storage IDs; add no new persistence model.
- [x] Add labeled preset preview buttons with exact accessible names, `aria-pressed`, keyboard focus, and non-color selection cues.
- [x] Keep all non-appearance settings and exact existing functional behavior.
- [x] Ensure swatch palettes come from canonical CSS values and do not override parent/app theme tokens.

### 5. Add isolated regressions and finish review

- [x] Add `e2e/theme.spec.mjs` using `fixtures.mjs` and existing color math. Do not import reset-on-start legacy rendering suites.
- [x] Verify all six resolved palettes, stored preferences, before-body attribute application, explicit mode vs OS changes, and default fallback behavior.
- [x] Sample rendered text/background and key graphic pairs, including hero negative balances, ordinary status notices, and charts on their unchanged surface.
- [x] Cover 375/390/430px and desktop layouts, >=44px targets, >=16px form controls, focus visibility, enlarged text, long names, large negative amounts, reduced motion, and all six navigation destinations.
- [x] Exercise existing financial/appearance workflows through the current iPhone test suite; compare visible values/actions with the unchanged API contract.
- [x] Capture final isolated screenshots; review light/dark and three presets visually, not just through token values.
- [x] Update frontend theme docs to match the deliberately broader preset contract, run `trellis-check`, review the final diff, and report exact passes/unavailable checks.

## Validation Commands

From the repository root:

~~~powershell
pnpm -r run typecheck
pnpm -r run lint
pnpm -r run test
pnpm -r run build
node node_modules/@playwright/test/cli.js test --config packages/web/playwright.config.mjs
~~~

The web build already includes mobile, motion, color, and PWA audits. For a focused iteration:

~~~powershell
pnpm --filter @jizhang/web run check:mobile
pnpm --filter @jizhang/web run check:motion
pnpm --filter @jizhang/web run check:color
~~~

If bundled Chromium is unavailable, the existing installed-Chrome fallback is only for the Chromium project:

~~~powershell
$env:JIZHANG_E2E_CHANNEL = 'chrome'
pnpm exec playwright test --config packages/web/playwright.config.mjs --project chromium-iphone
Remove-Item Env:JIZHANG_E2E_CHANNEL
~~~

Run WebKit separately without the Chrome override when its binary is available. Request approval for downloads if needed and report unrun WebKit/physical-iPhone checks honestly. Do not start, reset, seed, or stop the user's real development/production ledger for validation. Do not run broad formatting against unrelated files.

## Acceptance Mapping

| Acceptance | Evidence |
|---|---|
| AC1-AC2 | Dashboard/settings screenshots and six-palette computed-style checks. |
| AC3 | Existing iPhone functional suite plus route/state/action assertions. |
| AC4 | Reload/first-paint/OS-preference browser checks with existing storage values. |
| AC5 | Extended static matrix and rendered contrast sampling. |
| AC6 | Measured viewport/control boxes, enlarged-text/edge-data checks, device follow-up where available. |
| AC7 | Exact command outcomes; missing engines/device checks listed separately. |
| AC8 | Final path/diff/dependency inspection and isolated fixtures only. |

## Review and Rollback Boundaries

Each slice must be reviewable with its matching tests. If a refactor is unavoidable, separate it from the visual change and show behavior-equivalent tests before proceeding. Any necessary store/API/schema/router or additional-page layout change requires scope review rather than silent expansion.

Rollback only this task's reviewed edits together, including the palette, manifest assertion, and spec contract; do not use destructive resets or revert unrelated work. No commit, branch creation, or task archive is requested by this plan.

## Planning Evidence Already Produced

The static concept's six palette switches, explicit/system display-mode controls, 375/390/430/1420px document/phone/figure overflow checks, >=44px preview buttons, and absence of browser script errors pass. Candidate color math passes 138 text pairs. These are design-prototype checks, **not production test results**.

## Execution Result

All implementation/review steps above were performed; this is not a claim that every
legacy engine test is green. See `verification.md` for the two reproduced baseline WebKit
failures and the physical-device follow-up. Production checks, 537 unit tests, all nine
Chrome cases, and all five WebKit theme cases pass. The task remains open for visual review.
