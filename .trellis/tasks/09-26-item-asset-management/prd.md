# Personal Item Asset Management

## Goal

Add a personal item inventory to the existing bookkeeping app so the user can record individual possessions, see holding duration and average daily cost, and track sale or retirement without changing bookkeeping behavior.

## Background and Constraints

- The user wants an item lifecycle experience inspired by “有数”: item photos, holding duration, daily cost, status, and sale recap.
- Existing bills, accounts, budgets, statistics, imports, and AI assistant remain available and unchanged. Items are independent records and never become ledger transactions automatically.
- The user confirmed purchase/sale amounts must not create bills automatically. An item may optionally link to an existing purchase expense and/or sale income; linking is informational and never mutates the transaction.
- The user chose to defer automatic object cutout and AI image recognition to a later phase. The supplied Windows/Python/FastAPI source is not part of this release.
- The deployment target is a new 4-vCPU/8-GiB server per the user. Current Fastify body limit is 8 MiB. Existing backups snapshot SQLite only.
- The approved Ardot concept is page “03 物品资产” in file 729347012405452. Its image-separation artboards are future-phase concepts; the MVP uses ordinary item-photo upload.

## Requirements

1. Provide individual item records with one optional photo, name, item-specific category, required purchase date, optional purchase amount, lifecycle status, and optional brand/model/note.
2. Support manual item entry and one photo upload per item. Do not call segmentation or visual-recognition models in this release.
3. Track “使用中”, “闲置”, “已售出”, and “已退役”. A sale records a date and optional proceeds; retirement records an end date without sale proceeds.
4. Display holding duration and average daily net cost from server-owned calculations. For unsold items use purchase amount divided by elapsed days; for sold items use purchase amount minus sale proceeds divided by holding days. Missing amount or zero elapsed days produces no daily-cost number.
5. Allow optional links to an existing ledger expense for purchase and an existing ledger income for sale. Links are informational; saving or changing an item never creates, edits, or deletes a transaction.
6. Keep item categories separate from expense/income categories so item classification cannot alter ledger organization.
7. Add access from the existing home and “我的” surfaces without adding/removing bottom tabs or changing existing routes.
8. Persist item photos across reloads and server restarts, and include them in the existing recoverable backup/restore workflow.
9. Keep image upload authenticated, bounded, validated by actual content, and served only through an authenticated API route rather than a guessed storage path.

## Acceptance Criteria

- The user can create, edit, list, search/filter, view, sell, retire, and soft-delete individual items on desktop and mobile.
- The server returns correct holding-day and daily-cost values for active, idle, sold, and retired items, including missing amounts and same-day dates.
- An item can link to existing purchase/sale transactions; linked rows remain unchanged, and deleting/purging a linked transaction does not delete or corrupt the item.
- Item CRUD and links leave ledger counts/amounts, account balances, budgets, and financial statistics unchanged.
- Item photos survive a process restart and a verified database backup/restore round trip.
- Invalid/oversized images, invalid lifecycle transitions, missing records, and unauthorized requests use the existing API error contract without leaking internal paths or errors.
- No source segmentation service, model weights, or AI image-classification call is shipped or enabled in this release.

## Out of Scope

- Automatic object cutout and AI visual recognition/classification (later phase; the supplied source requires deployment/resource and license review before integration).
- Receipt OCR or parsing WeChat/Alipay/bank statement images.
- Automatic creation or mutation of income/expense transactions.
- Shared/family accounts, multi-user permissions, or inventory quantity management.
- Market valuation, depreciation forecasts, reminders, warranty tracking, or pausable ownership periods.
