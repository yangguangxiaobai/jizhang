# Personal Item Assets — Executable Contract

This contract covers the independent item-inventory feature. Items are not ledger entries and
must not change transactions, balances, budgets, or financial statistics.

## 1. Scope / Trigger

- Trigger: additive SQLite migration plus authenticated API and Vue client data-flow contract.
- Use this contract when changing item records, lifecycle transitions, photos, or optional links
  to existing transactions.
- Automatic image cutout, visual recognition, receipt OCR, and automatic ledger writes are out
  of scope.

## 2. Signatures

### Database

- Migration: `010-item-assets`.
- `asset_items` stores one item record: `id`, `name`, `category`, `brand`, `model`, `note`,
  nullable `purchase_price_cents`, required `purchase_date`, `status`, nullable `closed_date`,
  nullable `sale_price_cents`, nullable purchase/sale transaction IDs, soft-delete flag, and
  timestamps.
- `asset_item_photos` stores at most one image per item as `{ item_id, mime_type, image_bytes,
  updated_at }`; its BLOB is included in the existing SQLite snapshot backup.
- These tables are additive. Do not add a foreign key from item records to transactions: bills
  may be deleted or purged while item history remains readable.

### HTTP API

- `GET /api/v1/items?status=&category=&q=&limit=&offset=` →
  `{ items: ItemDto[], total, limit, offset }`.
- `GET /api/v1/items/summary` → item-only status counts, cumulative purchase cents, and current
  daily-cost cents.
- `GET /api/v1/items/:id` → `ItemDto`.
- `POST /api/v1/items` → `201 ItemDto`; input includes required `name`, `purchaseDate` (local-date
  epoch milliseconds), optional `category`, `purchasePriceCents`, `brand`, `model`, `note`,
  `status` (`active` or `idle`), and `purchaseTransactionId`.
- `PATCH /api/v1/items/:id` → `ItemDto`; accepts partial editable item fields. Use the dedicated
  lifecycle endpoints to close an open item.
- `DELETE /api/v1/items/:id` → `204`; soft-deletes only the item.
- `POST /api/v1/items/:id/sell` input `{ closedDate, salePriceCents?, saleTransactionId? }`;
  `POST /api/v1/items/:id/retire` input `{ closedDate }`; both return `ItemDto`.
- `PUT /api/v1/items/:id/photo` accepts raw JPEG, PNG, or WebP bytes; `GET` at the same path
  returns the authenticated image; `DELETE` removes it.

`ItemDto` uses camelCase fields: `id`, `name`, `category`, `brand`, `model`, `note`,
`purchasePriceCents`, `purchaseDate`, `status`, `closedDate`, `salePriceCents`,
`purchaseTransactionId`, `saleTransactionId`, `photoUrl`, `heldDays`, `netCostCents`,
`dailyCostCents`, `createdAt`, and `updatedAt`.

## 3. Contracts

- All routes are registered inside the authenticated `authModule.extraRoutes` plugin. Reads
  require a session; writes also require `X-Requested-With: fetch`.
- Money is integer cents. Dates are local-calendar epoch milliseconds. The server owns all
  holding-day and daily-cost arithmetic; the web layer formats returned values only.
- Statuses are `active`, `idle`, `sold`, and `retired`. Open items have no `closedDate`. Sold and
  retired items require a close date. A sale's proceeds and sale link may be unknown.
- Purchase transaction links must point to a live, non-refund expense. Sale links must point to a
  live, non-refund income. Links are informational: create/edit/sell/retire never create, update,
  or delete ledger rows. A later deletion of a linked transaction does not invalidate the item.
- `heldDays = max(0, localDay(closeDate ?? today) - localDay(purchaseDate))`.
- For active/idle/retired records, `netCostCents = purchasePriceCents`. For sold records,
  `netCostCents = purchasePriceCents - salePriceCents`. `dailyCostCents` is rounded net cost
  divided by held days; it is `null` when net cost is unknown or held days is zero. Negative sold
  net cost is valid.
- Photo payload limit: 2 MiB. Only JPEG/PNG/WebP are accepted; validate MIME/signature and image
  dimensions (maximum 40 million pixels). List DTOs never contain image bytes. The photo GET is
  session-protected and responds with `Cache-Control: no-store` and `X-Content-Type-Options:
  nosniff`.
- Item categories are free text/default to `其他`; they are not expense/income categories.
- All item endpoints use the existing `{ error: { code, message } }` API error envelope.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Missing session | `401` |
| Write without CSRF request header | `403` |
| Missing item or missing photo | `404` |
| Malformed field, future purchase date, invalid link/type, or close date before purchase/after today | `400` |
| Attempt to sell/retire a non-open item | `409` |
| Photo exceeds 2 MiB | `413` |
| Unsupported MIME, invalid image signature/dimensions, or more than 40 million pixels | `400` |
| Unknown/deleted transaction supplied as a new link | `400`; an already-stored stale link does not block unrelated edits |

## 5. Good / Base / Bad Cases

- **Good:** create a camera body with a known purchase amount and date; optionally link a live
  purchase expense; later sell it and optionally link a live income. Item history updates while
  ledger rows and financial projections remain unchanged.
- **Base:** create an item with an unknown price, or a same-day purchase; return `null` for daily
  cost rather than inventing a value.
- **Bad:** create a transaction as a side effect of saving the item, link income as the purchase,
  accept an SVG as an image, or compute holding cost independently in Vue.

## 6. Tests Required

- `packages/server/test/db.test.ts`: assert both tables exist after fresh initialization and
  migration is repeatable.
- `packages/server/test/items.test.ts`: assert session/CSRF guards, CRUD/filter/search, field and
  date validation, lifecycle transitions, transaction-link types, ledger/stat/budget invariance,
  image MIME/size/dimension limits, authenticated no-store/nosniff retrieval, and photo bytes
  surviving a backup/restore snapshot.
- `packages/web/e2e/item-assets.spec.mjs`: on Chromium and WebKit iPhone viewports, create an item
  linked to an existing expense and assert the transaction count does not increase.
- Run server/web lint and typecheck, workspace tests, and the web production build/PWA gates after
  changing this contract or its implementation.

## 7. Wrong vs Correct

### Wrong

```ts
// Saving an inventory record must not write a second financial fact.
await api.transactions.create({ type: TYPE_EXPENSE, amountCents: item.purchasePriceCents });
```

### Correct

```ts
// Store an optional reference only; the server verifies its purpose and leaves the bill intact.
await api.items.create({ ...item, purchaseTransactionId: selectedExistingExpenseId });
```
