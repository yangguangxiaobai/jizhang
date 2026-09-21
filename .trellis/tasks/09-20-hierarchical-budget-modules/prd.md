# Hierarchical Budget Modules and Child Categories

## Goal

Allow a budget template to allocate money to a parent module while keeping detailed child categories for ledger entry and spending analysis.

Example: the template assigns 40% to “生活”; “住房”, “水电气”, and “出行” remain selectable bill categories and consume the shared “生活” pool.

## Confirmed Repository Facts

- Categories are currently flat rows with no parent/group relation.
- Transactions store one categoryId.
- Template modules store categoryId plus ratio.
- Budget allocations store categoryId plus amountCents.
- The shared budget engine merges allocation rows by category id and aggregates spending by transaction category id.
- Existing users already have flat categories and historical allocation snapshots.
- The user approved the product semantic: parent modules are budget pools, child categories are details within the pool.
- The user approved a global hierarchy: category management owns the parent/child relationship, templates allocate parent modules, and standalone categories remain supported.

## Requirements

### R1. Parent modules and child categories

- Support one parent level: a parent budget module may contain multiple child expense categories.
- Child categories remain the categories selected when recording transactions.
- A category without a parent remains a standalone budget module.
- Do not introduce arbitrary multi-level nesting in the MVP.
- Income categories remain outside the expense budget hierarchy.

### R2. Template allocation

- New templates allocate ratios to parent modules or standalone categories, never selecting a parent and one of its children together.`n- Existing legacy templates that reference child categories remain readable and are not silently rewritten.
- Ratios still sum to 100% and preserve the existing integer-cent rounding rule.
- The template editor must make the distinction between parent modules and child categories clear.
- Applying a template to an existing current cycle remains an explicit confirmed action; historical cycles must remain unchanged unless explicitly designed otherwise.

### R3. Budget calculation and display

- A parent module budget is a shared pool.
- Spending for all child categories rolls up to the parent module for budget usage and remaining-pool calculations.
- The budget page shows the parent pool's budget, spent, remaining, and over-budget state.
- Child categories remain visible as a spending breakdown under the parent.
- Child categories show actual spending only; no child budget or child remaining amount is invented.
- The client must not reimplement budget arithmetic; aggregation remains server/shared-engine logic.

### R4. Category management

- Category management must allow creating or editing a parent module and assigning child expense categories to it.
- A child category can be moved to another parent or made standalone.
- Deleting a parent must not delete child categories or historical transactions; the UI must require a safe reassignment or make the children standalone.
- Existing soft-delete and built-in-category protections remain intact.

### R5. Compatibility and migration

- Existing categories, transactions, templates, and allocation snapshots must remain readable.
- Existing flat categories start as standalone modules unless the user explicitly groups them.
- Existing historical transactions retain their original child category ids and names.
- No automatic historical reclassification is allowed.
- Any schema change must be versioned and reversible through the normal migration/backup path.

### R6. Verification

- Add server/shared tests for parent-pool aggregation, standalone categories, child re-parenting, zero/empty child cases, and historical compatibility.
- Add browser coverage for managing a hierarchy, selecting parent modules in a template, recording a child-category transaction, and seeing the parent pool update.
- Preserve existing budget, template, import/export, mobile, theme, and deployment checks.

## Acceptance Criteria

- [ ] A parent module can contain child expense categories and the relationship survives reload.
- [ ] A template can allocate to a parent module and rejects selecting both a parent and one of its children in the same template.
- [ ] A child-category bill is shown under its parent and contributes to the parent's spent amount.
- [ ] Child rows show actual spending without fabricated child budget quotas.
- [ ] A parent pool can go negative and uses the existing over-budget/carryover semantics.
- [ ] Standalone categories continue to work exactly as before.
- [ ] Existing flat data loads without migration loss.
- [ ] Historical cycles remain unchanged after grouping changes and after applying a new template to the current cycle.
- [ ] Existing tests remain green and new hierarchy tests cover the parent/child boundaries.

## Confirmed Product Decisions

- A parent owns one shared budget pool.
- Child rows show actual spending only; they do not receive independently derived budgets.
- Parent modules are grouping/budget entities only and cannot be selected directly on a bill; bills use a child or standalone category.
- Existing built-in categories remain standalone by default; the first release does not auto-create or auto-assign groups.
- Assigning a child to a parent immediately changes display aggregation without changing any stored amount; template application remains the explicit budget-rewrite action.

## Planning Status

Product decisions are complete. The remaining representation choice is technical and is recorded in design.md: reuse category rows with a nullable parent relation so existing template and allocation ids remain compatible.

## Out of Scope

- Arbitrary nesting deeper than one parent level.
- Automatic reclassification of historical transactions.
- Independent child budgets unless explicitly approved as a separate product decision.
- Changing income, account, tag, recurring-bill, or import semantics unrelated to category hierarchy.






