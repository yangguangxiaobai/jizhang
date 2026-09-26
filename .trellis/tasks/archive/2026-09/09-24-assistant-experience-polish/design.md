# Design: AI assistant history and entry polish

## Change boundary

The server already owns conversation persistence and exposes `GET /assistant/conversations`
and `GET /assistant/conversations/:id/messages`. The behavior gap is discoverability and
presentation, not missing storage. Keep all business writes on the existing preview/confirm
path.

Expected source changes:

- `packages/web/src/views/AssistantView.vue`: always-visible accessible history disclosure,
  selection/loading state, localized confirmation field labels/values, and responsive card
  hierarchy.
- `packages/web/src/views/DashboardView.vue`: add a prominent route button to the assistant
  near the top of the home page, reusing existing icons/tokens.
- `packages/web/e2e/iphone.spec.mjs`: cover history selection/reload, readable transaction
  confirmation fields, and home entry while preserving existing assistant/import scenarios.

Do not change database schema, routes, provider behavior, transaction arithmetic, attachment
retention, confirmation semantics, six-tab navigation, or manual entry.

## UI behavior

- Keep the recent conversation list inside an always-visible native `<details>` disclosure so
  it remains usable on phone without taking permanent vertical space. Label the count and each
  conversation's last-updated local date/time. Keep New conversation separate and obvious.
- Continue loading conversations newest-first through the current API; selection reads the
  selected timeline from the server. Do not cache transcript text in localStorage.
- Render action-card values in a two-column definition grid that collapses naturally at narrow
  widths. Translate known field names (including generic camelCase fallback), format integer
  cents as yuan, dates as local day labels, and category/account ids through the existing meta
  store. Arrays use readable labels; empty values are omitted or shown as “无” rather than raw
  JSON.
- Preserve the import-specific table and interactions. Keep operation, status, affected count,
  warnings, and primary confirm/cancel actions visible in the card.
- Place an AI assistant CTA before the balance/summary blocks on the dashboard. Reuse the
  existing sparkles icon and accent tokens; do not add colors or motion tokens.

## Verification

- E2E fixtures provide two server-backed conversations; assert selection changes the visible
  transcript and reload restores the newest conversation.
- Assert user-facing card labels and currency, and assert internal property names are absent.
- Assert the dashboard CTA routes to `/assistant`, the six bottom tabs remain, and the phone
  layout has no horizontal overflow.
- Run focused assistant browser coverage and canonical typecheck/lint/test/build checks. Keep the
  existing 320 KiB JS / 80 KiB CSS PWA limits; if visual CSS would exceed the CSS limit, reuse
  existing styles or trim only demonstrably redundant rules within touched components.
