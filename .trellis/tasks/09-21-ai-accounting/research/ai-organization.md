# Follow-up research: AI-assisted data organization

## Existing data boundaries

- Categories are soft-deleted master rows with one-level `parent_id`; category ids also appear in recurring rules, occurrences, templates, and budget allocation snapshots.
- Tags have no table: names live in `transactions.tags_json`; existing normalization trims, deduplicates, caps tags at 32 characters and limits each transaction to 20 tags.
- Existing tag rename/delete operations rewrite live transactions in one SQLite transaction.
- Category usage currently reports live transaction references only; it does not cover recurring, template, budget, pending, or trash dependencies.
- The platform import preview is the best UI precedent: dry-run preview, per-row selection/overrides, then one transactional confirmation.

## Recommended safe MVP

1. Read-only organization preview page and endpoint.
2. Deterministic server analysis for exact/normalized duplicate tags, duplicate leaf categories grouped by type/parent, and informational anomalies.
3. AI may rank or explain suggestions only using server-provided ids; it must not invent ids or calculate money.
4. Explicitly selected actions only: tag canonicalization; category merge only for leaf categories with matching type/parent, no builtin loser, and no hidden dependencies.
5. Anomalies remain flags in the first slice—no automatic deletion or changes to amounts, dates, accounts or notes.

## Apply/undo requirements

- Preview must not write rows and must return action ids, counts, before/after samples, blockers, confidence/reason, and version/hash preconditions.
- Apply revalidates a preview and aborts the whole operation if stale; all writes run in one SQLite transaction.
- Add an append-only organization audit table via a new migration.
- Record operation id, action kind, source/target ids, affected row ids, before/after values, timestamp and status; never store prompts, provider responses, secrets or raw notes.
- Undo only when current values still equal the recorded after-state; otherwise return a conflict.

## Shared-file conflicts

Keep organization logic in new `ai-organization-service.ts`, route DTOs, view and tests. Avoid embedding batch operations in `ManageView.vue` or making the UI call category/tag endpoints row by row. This feature must be implemented after the monthly provider-context work because both follow-ups share `ai.ts`, `ai-types.ts`, `ai-provider-service.ts`, `ai-config-service.ts`, `ai.test.ts`, and `api/client.ts`.
