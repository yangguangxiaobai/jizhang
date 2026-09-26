# Frontend Screen Inventory

Source: `packages/web/src/router/index.ts` and the corresponding view templates. Route aliases that share a view are states of one screen.

| Screen | Routes / states | Existing content and actions to preserve | Visual focus |
|---|---|---|---|
| Login | `/login` | Username/password, submit, loading/error | Compact branded entry, clear field focus and submit feedback |
| Shared shell | Every authenticated route | Sticky title/user, offline/install notices, six bottom tabs, safe areas | Consistent page width and navigation hierarchy |
| Dashboard | `/` | Account balance, monthly flow, budget status, pending recurring count, recent bills, assistant entry, transfer/navigation actions | Separate balance stock from monthly income/expense flow; make next actions visible |
| Transactions | `/transactions` | Month navigation, type/account/category filters, search, clear filters, detail/edit/delete, manual entry | Scannable amount/date/category rows and compact but discoverable filters |
| Transaction editor | `/transactions/new`, `/transactions/:id/edit` | Income/expense switch, amount, category, account, date, note, tags, refund linkage, submit/cancel/delete | Amount-first entry, grouped supporting fields, visible new/edit state |
| Transaction detail | Modal from transaction list | Existing transaction details and close/edit affordances | Readable summary with distinct amount, category, account, date, and note |
| AI assistant | `/assistant` | Conversation history, messages, progress, file attachment, confirmation cards, import rows, results, archive/new conversation | Readable chat, persistent composer, clear preview/confirm separation |
| Budget | `/budget` | Current/history period selector, allocation summary, category modules, carryover pool, overspend/near-limit states, salary/records/templates links | Make cycle, remaining budget, and pool relationship easy to understand |
| Salary entry | `/salary/new` | Amount/date/account/note and module allocations with balance validation | Keep allocation total and invalid/unbalanced state visible while editing |
| Salary records | `/salary/records` | Expandable allocation details, delete, create salary, return to budget | Clear period grouping and expandable detail without dense text |
| Allocation templates | `/templates` | List, create/edit name, categories and ratios, add/remove modules, distribute evenly, save/delete/apply | Explain ratio totals and validation beside the editor |
| Statistics | `/stats` | Range controls, category share, monthly income/expense chart/table, carryover-pool trend | Separate chart sections and retain exact server-provided values |
| Category/account management | `/manage` | Category/account tabs, create/edit/reorder/delete, color/icon selection, usage warnings, transfers link, tag rename/delete | Distinguish data types and make destructive or ordering actions clear |
| Trash | `/trash` | Empty state, restore one/all, permanent purge all | Distinguish recovery from permanent deletion |
| Transfers | `/transfers` | Filter, list, edit/delete, create, return | Show source and destination as a movement, not income or expense |
| Transfer editor | `/transfers/new`, `/transfers/:id/edit` | Amount, from/to accounts, date, note, save/cancel | Pair the two accounts and keep amount prominent |
| Recurring rules | `/recurring` | Pending count, warnings, enabled toggle, create/edit/delete, history | Separate due decisions from reusable rules and history |
| Recurring-rule editor | `/recurring/new`, `/recurring/:id/edit` | Name, income/expense, amount, account/category/date/frequency and active state | Keep schedule and amount legible while editing |
| Pending occurrences | `/pending` | Empty state, occurrence details, confirm/ignore | Make each due item and the consequences of each action clear |
| Data management | `/data` | CSV export/import, WeChat/Alipay import modal, backup creation, restore instructions, online/busy states | Group portability actions by purpose and distinguish preview from execution |
| Settings | `/settings` | Profile/logout, appearance modes/presets, budget-cycle preferences, data links, password change, about | Organize settings into labeled groups and preserve selected states |
| AI provider settings | `/settings/ai` | Enable/provider details, URL/method/model/auth/secret, save/test, saved-secret state, safety explanation, assistant link | Explain connection status and secret retention without exposing a saved key |

## Shared component states

- Import dialog and rows: file selection, parsing/loading, preview totals, duplicates/ignored rows, selection, category override, warning, error, confirm/cancel.
- AI settings: disabled/enabled, unsaved/saving, saved secret present, connection test in progress/success/failure.
- Charts: populated, empty, long-label layouts; amounts remain readable at narrow widths.
- Shared views: loading, offline, error, empty, disabled, validation, success, and destructive-confirmation states where present.

## Global constraints

- Mobile-first artboards use the existing 375 px baseline; preserve the six-tab order and 44 px control targets.
- Carry forward the approved warm/deep-blue palette and existing theme tokens across light/dark and titanium/forest/mono presets.
- Keep bill values, budgets, balances, trend data, and validation sourced from existing APIs/stores.
- Preserve all current route names and actions while improving visual grouping and hierarchy.
