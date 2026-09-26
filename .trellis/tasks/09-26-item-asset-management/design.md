# Technical Design — Personal Item Assets

## Scope Boundary

The behavior gap is that the app can record money movements but has no durable record for an individual possession or its lifecycle. This release adds an item domain beside—not inside—the cash ledger.

In scope: item records, one optional photo, lifecycle/cost calculation, optional existing-transaction links, authenticated API, responsive views, and persistence/backup. Automatic cutout and visual AI recognition are explicitly deferred.

## Data Flow

```
Vue item form/list
  → typed api client
  → authenticated Fastify item routes
  → ItemService validation + lifecycle projection
  → SQLite asset_items + asset_item_photos
  → typed DTO / authenticated photo response
  → Pinia item store and item views
```

Money remains integer cents and dates remain local-date epoch milliseconds at the API/domain boundary. The web client formats values but never computes financial rollups or holding-cost figures.

## Persistence Model

Add migration 010 as an additive TypeScript migration.

- `asset_items`: id, name, free-form item category, optional brand/model/note, optional purchase price in cents, required purchase date, status, optional closed date/sale proceeds, optional purchase/sale transaction ids, deleted flag, created/updated timestamps.
- `asset_item_photos`: item id, MIME type, binary image bytes, updated timestamp. Keep photo bytes out of list DTOs.
- Use the existing business-row soft-delete convention. Do not add foreign keys from item rows to transactions; current business tables intentionally avoid that coupling and transactions can be purged.
- Category names belong to the item domain. The MVP suggests common labels and existing item labels but does not reuse or mutate expense/income categories.
- One purchase/sale transaction may be linked to multiple items (for example, several items from one purchase). A link is not a ledger write. If a linked transaction is later purged, the item remains and the UI marks the reference unavailable.

SQLite BLOB storage is selected for MVP photos so the existing `VACUUM INTO` database backup and CLI restore naturally include item records and their photos. This avoids a separate media archive/restore protocol. The API accepts only bounded image payloads (maximum decoded size 2 MiB); the client resizes/compresses before posting, keeping the base64 JSON request below the current 8 MiB body limit. Reject SVG and validate MIME/signature; return photos only through an authenticated route with `no-store` and `nosniff`.

## Lifecycle and Metrics

- Status wire values: `active`, `idle`, `sold`, `retired`; Chinese UI labels are 使用中 / 闲置 / 已售出 / 已退役.
- Purchase date is required; purchase amount may be unknown. Sold/retired items have a close date. Sale proceeds may be unknown.
- Active and idle durations end at the captured server-local date; sold/retired durations end at their close date. Reject close dates before purchase dates.
- `heldDays = max(0, localDay(closeOrToday) - localDay(purchaseDate))`.
- `netCostCents`: purchase amount for active/idle/retired; purchase amount minus sale proceeds for sold. If the required amount is unknown, return null.
- `dailyCostCents`: rounded net cost divided by held days; return null for zero days or unknown net cost. A negative sold-item net cost is valid and represents proceeds above purchase cost.
- The server returns these projections in list/detail/summary DTOs. They do not feed account balances, budgets, or financial statistics.
- State transitions: active ↔ idle; active/idle → sold or retired. An explicit edit may correct a closed state back to active/idle only when close/sale fields are cleared together.

## API and Validation

Add an `items` route module and service; register the routes in the existing `authModule.extraRoutes` array so session and CSRF guards protect every operation.

- `GET /api/v1/items` — list with optional status/category/search filters.
- `GET /api/v1/items/summary` — item-only counts and totals, explicitly not account balances.
- `GET /api/v1/items/:id` — item detail and transaction-link availability.
- `POST /api/v1/items`, `PATCH /api/v1/items/:id`, `DELETE /api/v1/items/:id` — create/update/soft-delete.
- `POST /api/v1/items/:id/sell`, `POST /api/v1/items/:id/retire` — validated lifecycle transitions.
- `PUT /api/v1/items/:id/photo`, `GET /api/v1/items/:id/photo` — bounded photo write and authenticated binary response.

Validate integer-cent fields, local dates, status transitions, category/name lengths, photo MIME/signature/decoded size, and transaction links. A purchase link must resolve to an existing non-refund expense; a sale link must resolve to an existing income. Preserve the existing `{ error: { code, message } }` response shape; never expose bytes, host paths, or internal errors in normal DTOs/logs.

## Frontend

- Add typed item DTOs and URL builders in `packages/web/src/api/client.ts`; no direct fetches from views.
- Add an item store because list, detail, and post-mutation refreshes share server data.
- Add list, create/edit, and detail/lifecycle views and routes. Keep the existing six-tab shell unchanged; link the feature from the dashboard and “我的”.
- Use one optional photo input, independent item-category choices, purchase/sale forms, and an existing-transaction picker. On selecting a transaction, prefill item fields but keep item data independent; never submit a ledger mutation.
- Use existing theme tokens, 44px touch targets, 16px form text, safe areas, and server-returned holding metrics.

## Compatibility, Backup, and Rollback

- Migration 010 is additive; old code can ignore the new tables, and existing ledger rows are untouched.
- Existing database backups already include BLOB data via SQLite snapshot. Tests must prove an item/photo survives backup/restore.
- Existing routes, imported files, and financial computations remain unchanged. Regression tests compare ledger/account/budget/stat outputs before and after item operations.
- No Python runtime/model dependency, new container, port, environment variable, or external image API is introduced in this release.
- Rollback is code rollback only; do not attempt a destructive down migration.
