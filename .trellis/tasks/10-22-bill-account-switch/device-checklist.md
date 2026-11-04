# Account switching — deferred device acceptance

Status: NOT RUN. No device/emulator installation, production API call or live ledger write is authorized by this task. Local JVM/API tests and debug compilation are separate evidence, not completion of this checklist.

Use an isolated test ledger with two distinguishable accounts A/B, A having at least 51 bills in one month, B having several bills, plus an empty account, another month, income/expense/refund transactions and a soft-deleted account retaining live historical bills. Do not seed or delete production transactions for testing.

| Check | Action / expected outcome | Current evidence |
|---|---|---|
| Entry | Enter bottom-tab 账单. An account selector is visible between month and type controls; default reads 全部账户. | Device not run |
| Identity | Open selector, select A, B and all. Selected name, rows and total match; same-name accounts must remain identified by ID internally. | Device not run |
| Filters | Select month and income/expense type, then switch A→B. Month/type remain selected and combined query results are correct. | Device not run |
| Pagination | On A page 2, switch to B. Return to page 1 with B rows/total. Next/previous and explicit refresh preserve the selected account. | Device not run |
| Empty | Select an empty account or a month with no matching bills. Show useful empty state and clear/adjust guidance, not another account's rows. | Device not run |
| History | Select the soft-deleted funding account. Its live historical bills remain readable; do not infer a deletion badge from missing metadata. | Device not run |
| Rapid selection | With controlled slow isolated server responses, switch A→B→A and interleave refresh/page loads. No stale success/error/finally takes over the latest query. | Device not run |
| Failure | Fail B's load after A has loaded. B remains selected, A rows/count are not shown as B, and retry reloads B. | Device not run |
| Metadata | Fail transaction list only: accounts still load. Fail account list: visible retry appears; successful old choices remain usable; retry preserves selection. | Device not run |
| Delete tail | On an isolated account's last page, delete its last bill. Confirm corrected page and query/account, no blank permanently out-of-range page. | Device not run |
| Navigation | Open details/edit and return. Existing navigation works; do not assume a new cross-detail/tab persistence guarantee. | Device not run |
| Layout | Check long names, narrow screen, large font, light/dark theme. Dropdown selected text and checkmarks remain readable without overlapping arrows/type controls. | Device not run |
| Accessibility | TalkBack announces 账户 selector, selected value and account options with usable touch targets. | Device not run |

Record device model/OS, installed APK SHA-256, isolated server version, actions, observed results and evidence paths before changing any row to passed.
