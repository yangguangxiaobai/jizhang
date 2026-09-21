# Design: Hierarchical Budget Modules

## Status and boundary

Product decisions are complete for the MVP:

- A parent is a shared budget pool.
- Children are bill categories and show actual spending only.
- Parents cannot be selected directly on new bills.
- Assigning a child to a parent changes aggregation immediately without changing amounts.
- Rewriting a current cycle's allocations remains an explicit confirmed template action.
- Existing categories remain standalone until the user groups them.

The smallest behavior gap is that the budget engine currently treats every category id as an independent module. The hierarchy belongs at the category/engine boundary, not in the page alone.

## Representation

Use the existing categories table with one additive nullable column:

- categories.parent_id: nullable expense-category id.
- A category with children is a parent budget module.
- A category with no parent and no children is a standalone module.
- Income categories always have parent_id null.
- Only one level is allowed: a parent must itself have parent_id null.
- No separate group table is introduced in the MVP, so existing category ids remain valid in transactions, templates, and allocation snapshots.

Add migration 007 with the new column and an index. Existing rows receive null and remain standalone.

The service layer validates:

- parent and child are different live expense categories;
- the selected parent has no parent itself;
- income categories cannot be grouped;
- assigning a parent cannot create a cycle;
- a category with children cannot be selected for a new transaction;
- deleting a parent first detaches its children to standalone categories, after explicit confirmation.

## Budget-engine contract

Keep existing engine results and calls byte-compatible when no hierarchy map is supplied.

Add an optional category-parent projection to the shared budget-engine input. Normalize both:

- allocation category ids;
- transaction category ids;

to their top-level budget module before merging or spending aggregation. This means:

- old allocation snapshots continue to work;
- grouping a category immediately rolls its historical/current budget and spending into the parent;
- monetary amounts are not rewritten;
- standalone categories behave exactly as before.

The budget API adds optional child breakdown data to each module response. The parent fields remain the existing budget/spent/remaining contract. Each child breakdown contains category id, name, and actual spent cents only; it never invents a child budget.

The pool and trend calculations use the same normalized module projection as the budget overview. Stats and budget therefore cannot disagree about a grouped module.

## Frontend behavior

- Manage categories displays one-level nesting and a parent selector for expense categories.
- Existing categories start ungrouped.
- Template editing lists only top-level expense modules (parents and standalone categories). Legacy templates that reference a child remain readable and preserve those targets unless the user explicitly replaces them; the UI never silently changes their ratios.
- Budget cards show the parent pool first and an expandable child-spending list below it.
- Transaction category pickers show standalone categories and child categories, but not a parent with children.
- No new child-budget editor is added.

## Compatibility and risks

- Historical transaction ids and names stay unchanged.
- Group membership is metadata, so changing membership changes display aggregation for old and current periods by design; no money is moved.
- Existing template and allocation JSON remains parseable because category ids stay strings. New parent targets use the same field.
- Existing import/export endpoints keep their current ledger semantics; hierarchy metadata is not inferred from transaction rows.
- Migration runs with the existing backup-before-upgrade contract.
- Rollback is code/image rollback; migration 007 is additive and old code can ignore the nullable column.

## Verification plan

- Shared unit tests: standalone parity, child allocation rollup, child spending rollup, re-parenting, parent over-budget, and empty child breakdown.
- Server tests: category CRUD validation, transaction rejection for parent categories, budget overview/stats parity, migration compatibility, and parent deletion detachment.
- Browser tests: create parent, assign children, edit template with parent, record child bill, see parent pool and child spend, and verify no parent in the bill picker.


