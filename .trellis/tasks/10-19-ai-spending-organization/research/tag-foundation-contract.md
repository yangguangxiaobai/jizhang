# Tag Foundation Contract (backend slice proposal)

Status: source-audited implementation contract for this authorized backend slice; not the full AI organization API. It is deliberately limited to stable tag metadata and compatibility with the repository's existing name-array contract.

## Compatibility invariant

`transactions.tags_json` remains the canonical transaction association representation: JSON arrays of legacy names, unchanged on metadata backfill. Existing transaction DTOs, CSV, old tag management APIs, imports/exports, assistant tools, organization merge/apply/undo and transaction CRUD keep their current flat-name semantics. Stable IDs identify hierarchy metadata only; this version does not change clients to ID associations and does not store a second association table.

Every newly introduced/updated live tag association must resolve to one active metadata entity by globally unique active name. An unresolved legacy label may still round-trip through old transaction APIs/import/export. Hierarchy operations/filtering that need identity must return a stable ambiguity/unresolved error rather than guessing. Because legacy name arrays cannot disambiguate branch identity, duplicate active names across branches are rejected. Names retain current normalize/length rules (trimmed, maximum 32 characters), and transaction association maximum remains 20.

## Additive metadata schema

Migration 013 adds an independent `tags` metadata table with opaque stable text ID, name, nullable `parent_id`, `deleted`, and timestamps; self-reference uses `ON DELETE RESTRICT` (business lifecycle is soft delete). Add an active-name uniqueness constraint/index consistent with global flat-name identity, and an active-parent lookup index. Root has depth 0; a child must point to a live root and has depth 1. No third level, self-parent, cycle, or cross-branch duplicate active label is allowed. IDs are generated for new metadata; legacy backfill IDs are deterministic from exact canonical legacy name with collision checks so repeated startup/migration cannot create duplicates.

Migration backfills distinct normalized valid names found by defensive parsing of **all** transaction rows, including soft-deleted ones. It never updates transaction rows or their JSON bytes. Malformed JSON yields no discovered metadata and is not rewritten. The metadata `deleted` flag does not remove a historical name from transaction storage/export.

## Catalog synchronization: one explicit boundary

Do not lazily mutate metadata from GET. Migration performs initial legacy backfill. Thereafter every path that can introduce/rename/remove a legacy association must participate in the same `TagCatalogService` synchronization methods inside its existing transaction:

- `TransactionService` create/update and any restore path that changes associations.
- `MasterDataService.renameTag/deleteTag` and assistant `tag.rename/tag.delete` (which already delegate here).
- AI organization tag merge/apply/undo paths that directly rewrite `tags_json`.
- Portability CSV/JSON import insertion and merged import batch insertion.
- Any other direct `tags_json` SQL writer found by the implementation audit.

Reads of old APIs and exports remain legacy-authoritative and must not silently create catalog rows. Metadata sync inserts missing root metadata only for names successfully accepted by an association writer; deletion/rename updates metadata lifecycle/name in the same transaction as the existing live-row rewrite. An implementation that cannot route every association writer through the same synchronizer is incomplete and must not expose a hierarchy API as authoritative.

Legacy backfill and metadata reconciliation never modify financial fields or source note. Existing name-array serialization behavior (including malformed JSON defensive handling) remains unchanged except where the existing lifecycle operation already rewrites rows.

## Lifecycle and hierarchy mutation

New authenticated hierarchy operations are additive and live in the existing protected master-data/tag route plugin, not category routes. GET hierarchy is strictly read-only and never invokes reconciliation/backfill. Write operations require the existing mutation CSRF header and normal authenticated session; DTOs use validated names and stable IDs.

- Create root or child with optional `parentId`; parent must be active root. Name must satisfy existing name rules and active global uniqueness.
- Update hierarchy metadata permits rename and parent change. Parent reassignment validates depth, self/cycle and uniqueness before any write. Reparenting does not change legacy transaction associations.
- Name-based old rename retains established behavior: rewrite existing live transaction associations atomically, update the same metadata entity name, preserve entity ID/parent, and do not leave a second active identity. Soft-deleted transaction rows follow existing legacy operation semantics; no extra data rewrite is introduced by metadata synchronization.
- Old name-based delete preserves its established live-row association removal behavior, then soft-deletes metadata rather than physically deleting identity. A parent with active children cannot be deleted until children are reparented/deleted. Re-create after deletion is a new identity; old transaction associations remain untouched except for the existing delete rewrite.
- Ambiguous or unknown metadata resolution is an explicit conflict/validation error, not an inferred entity.

## Hierarchy filtering

Legacy `?tag=<name>` remains exact current flat matching. Additive `GET /api/v1/tags/hierarchy` provides `{items:[{id,name,parentId,depth,count}]}`; counts are based on live transactions and safely parsed names. Add `tagId` transaction query filter:

- child ID: exact legacy name membership for that child;
- parent ID: exact membership for parent name OR any active direct child name, including direct parent assignments;
- transaction set/count is deduplicated using a correlated `EXISTS`/equivalent set predicate, never a join that expands transaction rows;
- it AND-composes with existing filters and uses current pagination/order/DTO semantics;
- simultaneous `tag` and `tagId` is 400.

If malformed JSON exists, existing parser semantics treat it as no tags. Soft-deleted metadata IDs are not filterable; transactions referencing a soft-deleted tag retain their legacy name for old API/export compatibility but do not silently resolve to another active entity.

## Explicitly not approved / out of this slice

No 500-record cap, note-suggestion retention policy, referenced-category-parent policy, AI analysis/apply/undo redesign, migration of transaction associations to IDs, duplicate same-name branches, Android/shared/spec/docs changes, deployment, or production data changes. These remain separate decisions/slices.

## Audited existing writer/read paths

Source scan found legacy reads/writes in:

- `services/transaction-service.ts`: create/update serialization, list filtering, `listTags`, DTO parsing.
- `services/master-data-service.ts`: name-derived list, rename/delete whole-live-row rewrites.
- `services/ai-organization-service.ts`: tag merge/apply/undo direct SQL updates.
- `services/assistant-tool-registry.ts`: tag management delegates to `MasterDataService`; transaction tool delegates to transaction service.
- `services/portability-service.ts`: export parsing plus single and versioned JSON import insertion paths.
- `services/import-batch-service.ts`: merged import transaction insertion.
- `services/tags.ts`: normalization/parser/serialization contract.
- Existing tests use direct SQL fixtures; these are test setup, not production writers.

No dedicated `routes/tags.ts` exists; current name CRUD is in `routes/master-data.ts`. New endpoints must be registered in that same guarded plugin context.
