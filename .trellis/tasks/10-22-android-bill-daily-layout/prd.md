# Android bill layout and daily summaries

## Goal and approval
User approved the five requested improvements and the proposed server summary extension with “按方案实施（推荐）” on 2026-10-22. This is approval to create and implement this scoped task.

## Requirements
- Replace redundant top-right new-entry action with the existing refresh action.
- Move month navigation beside the bill title.
- Remove previous/next page buttons and page numbers without hiding bills beyond the first API page; load the complete matching month automatically.
- Display expense and income beside each day, based on the complete currently filtered ordinary transaction scope, server computed with current shared contribution rules (refund income remains income, not negative expense). Salary and transfer rows are not part of this list or summary.
- Remove the account selector heading, retain its choice box and all choices.
- Preserve detail/edit/delete, query ownership, metadata failure isolation, historical account choices and same-query refresh fallback.

## Acceptance
- Header contains bill title, compact month arrows and a single refresh icon; no top new action or pagination controls.
- More than 50 and more than 500 matching records are all accessible after complete loading; stale/cancelled loads never publish across scopes; failed/inconsistent paging never reports complete success.
- Daily income/expense matches server-side filtered records, including refunds, zero amounts for the absent type, date boundaries and historical accounts. Summary unavailability is visible and never fabricated as zero.
- Account selector has no standalone heading and remains operable.
- Relevant server/shared/Android tests and build/lint are run and outcomes documented separately from device/deployment acceptance.

## Non-goals
No automatic deployment, installation, commits, database schema changes, global refund semantics changes, salary/transfer mixing, search restoration or unrelated dirty-worktree cleanup.
