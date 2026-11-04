# SQLite / JavaScript tag Unicode identity: resolution study

**Active task:** `.trellis/tasks/10-19-ai-spending-organization`  
**Scope:** research only. The task's migration 013 and backend tag implementation already exist. This note evaluates a P2 follow-up without changing product code, migration history, parser behavior, API shape, dependencies, or SQLite connection functions.

## Executive finding

There is a workable *ordinary-Unicode* solution in pure SQLite: derive a canonical key consisting of the lower-case hex UTF-16 code units of the JS-normalized name, and use it for catalog identity, migration/backfill, trigger joins, and legacy flat-name filter comparison. It can preserve the public flat `tags_json` representation and avoids a custom SQLite function. A bounded SQL scalar walk can implement the 32-UTF-16-unit cap (including a high-surrogate-only key at an astral boundary); the companion prototype and observed SQLite results are in `tag-unicode-sqlite-probe.py` below.

However, the requested full compatibility domain includes *lone escaped surrogates in raw JSON*. This is a hard boundary for SQLite JSON1: `json_each` converts `\\ud83d` to a replacement character (U+FFFD) on the actual app's SQLite 3.53.2, and `json_extract`, `json_quote`, and `json()` also expose/re-emit U+FFFD. No `json_each` value/key transformation can recover the original code unit after that lossy conversion. This isn't solved by hex-encoding SQLite's extracted value, by using an ASCII UTF-16 key, or by reading `fullkey`; those all see post-decode data.

Thus there is **no direct exact path through SQLite JSON1's extracted `value` / normalized JSON functions under every stated constraint**. A purpose-built SQL tokenizer over the original `tags_json` text could, in principle, recover raw string-token escapes and convert them directly to UTF-16-unit keys without a UDF. But that is a separate parser implementation (including arrays, nested/non-string values, escapes, trimming, order, malformed input) that must be replicated consistently in backfill, both triggers, and legacy filtering; I have not established it as a safe minimal implementation. A practical next step is an isolated SQL tokenizer prototype with differential tests against `JSON.parse` + existing `parseTagsJson`, on the bundled SQLite version, before declaring feasibility or changing product code.

The minimal safe short-term route is to keep this P2 unresolved and avoid silently indexing U+FFFD as though it were the source tag. If adopting a narrower guarantee is acceptable, an owner-approved design can support ordinary well-formed Unicode with the ASCII UTF-16 key and explicitly handle lone-surrogate entries as unsupported/fail-closed. Existing application writes can produce such raw values through JS `.slice(0, 32)` when the 32nd UTF-16 unit is a lone high surrogate, so that narrowing is a behavior change, not merely rejection of malformed external data.


## Constraints / compatibility contract checked

- `packages/server/src/services/tags.ts`: `normaliseTags` trims, then calls JS `slice(0, MAX_TAG_LENGTH)` where max is 32 **UTF-16 code units**, deduplicates in order, and `parseTagsJson` treats invalid/non-array JSON as empty. No parser behavior change is allowed.
- `packages/server/src/db/migrations/013-tag-hierarchy.ts`: the migration and both transaction triggers derive tag catalog names using SQLite `trim` + `substr(...,1,32)`, which counts Unicode scalar values; `tags_json` itself is not rewritten.
- `packages/server/src/services/transaction-service.ts`: the legacy flat `tag=` membership predicate independently repeats SQLite code-point truncation. It therefore must use the same canonical identity conversion as the catalog; changing only the catalog is insufficient.
- Existing hierarchy service/UI contracts use readable names. They must continue returning the original JS string (including a trailing lone high surrogate if allowed), not expose a hex key as a user-facing tag name.
- No UDF is viable: triggers and CLI/external SQLite writers would fail with “unknown function” unless every connection registers it. This is explicitly excluded.

## Candidate: canonical ASCII key derived in SQL

For every *well-formed scalar sequence* tag name, define:

```
key(name) = lower-case four-hex-digit UTF-16 code unit sequence
```

Examples:

| Name | Key |
|---|---|
| `A` | `0041` |
| `😀` | `d83dde00` |
| `A` × 31 + `😀`, JS slice(0,32) | `0041...0041d83d` (31 × `0041` plus the leading surrogate) |
| `😀` × 16 + `X`, JS slice(0,32) | `d83dde00` repeated 16 times |

Use this as the SQLite equality/join key. It is ASCII and injective over JavaScript UTF-16 sequences, including lone surrogates **once the code units have already been encoded into the ASCII key**. Passing a lone-surrogate JS string directly through better-sqlite3 is itself lossy (observed bytes `EF BF BD`); public names therefore need to be restored from an ASCII-safe stored representation with JS `JSON.parse`.

### Compatibility-preserving storage shape (design proposal, not approved implementation)

The least disruptive durable representation is an ASCII-safe `name_json` field (e.g. JSON string literal generated by `JSON.stringify(name)`) plus `name_key` as an indexed ASCII value. Existing `name` can remain a readable projection for ordinary valid names/backward compatibility, but cannot be authoritative for lone surrogates. An alternate is to make the key the `tags` primary identity and store only JSON-escaped display text, decoding at the DTO boundary.

That requires an additive migration and coordinated changes to:

1. migration 013 backfill, including dedupe and `legacy-` ID derivation;
2. insert/update triggers (including deleted-tag resurrection and unique active identity);
3. every SQL membership/filter/equality query, notably legacy transaction list filters;
4. `TagCatalogService` mapping, uniqueness, rename, parent/child counts, and old API DTO conversion;
5. any external/API SQL-writing compatibility contract.

A `name_key` key does **not** require changing `tags_json`: older clients still send and receive flat JSON name arrays. The canonical wire name can be decoded from a safe JSON string on the JS side. Existing stable catalog IDs should be preserved during migration where the name is representable; blindly replacing `legacy-` IDs with `legacy-<utf16key>` would break IDs already sent to clients, so ID continuity needs an explicit mapping/collision rule.

## Pure SQL strategy and its limits

For normal well-formed Unicode strings, SQLite can obtain each scalar via `json_each.value` / `substr(value,n,1)` and `unicode(...)`. A recursive or bounded sequence CTE tracks cumulative UTF-16 width (`2` for scalar > U+FFFF, otherwise `1`) and stops at width 32. It then emits one `printf('%04x', scalar)` for BMP scalars, two surrogate units for astral scalars, except when only one code unit remains, when it emits only the high surrogate. A Unicode-trim expression matching the current JS trim set must run *before* that walk. JSON non-string members must continue to be ignored, duplicates retain first position, and the cap of 20 distinct tags must remain ordered as today.

The CTE is expressible using built-in SQLite operations and window functions, not a user function. But it is substantially more complex than `substr`, and must be factored identically across the migration, both triggers, and filter SQL. The research probe demonstrates key behavior and UTF-16 boundary conversion; it is not a reviewed production query nor a proof of query-plan/performance suitability.

### Exact boundary probe outcomes (SQLite 3.53.2, bundled better-sqlite3)

A direct Node probe against `packages/server`'s installed `better-sqlite3` confirmed:

- `length('A' * 31 + '😀Z')` is 33 (SQLite Unicode codepoints), while JS UTF-16 slice(0,32) ends with just the high surrogate. `substr(...,1,32)` instead retains the complete emoji and is wrong.
- `length('😀' * 16 + 'X')` is 17; a correct UTF-16-unit cap retains 16 emoji and drops X.
- A raw JSON array member spelled `\\ud83d` is accepted by `json_valid`/`json_each`, but its extracted SQLite value's UTF-8 bytes are `EF BF BD`, not a representation of U+D83D.
- A valid escaped pair `\\ud83d\\ude00` decodes to normal U+1F600; JSON1 no longer preserves whether the input used escapes or a literal astral scalar (which is fine for a valid pair because those have identical JS string identity).
- `json_extract`, `json_quote(json_each.value)`, and `json(raw)` all show/emit U+FFFD for an unpaired surrogate on the bundled SQLite version.

The Python probe runtime used for the SQL CTE prototype reports SQLite 3.50.4 and *does* surface an unpaired surrogate as a non-standard UTF-8 surrogate byte sequence (`ED A0 BD`); the same probe code can therefore appear to “solve” the case there. That is an implementation/runtime difference, not a supported assumption. The actual backend's SQLite 3.53.2 result falsifies that assumption. The Node probe is the compatibility-relevant evidence.

## Why raw-token extraction isn't a quick escape hatch

`json_each.key` supplies the array index and `fullkey` supplies `$[n]`, but neither gives a source byte offset. `json_each.value` is already lossy for lone surrogates. Exact source recovery therefore needs a tokenizer over the original `tags_json` text to locate each array element's raw token, account for escapes, commas, nested/non-string values, whitespace, and malformed inputs, and decode JSON string escapes directly into UTF-16 code units. SQLite has no built-in raw-token offset or JSON-unescape-to-UTF-16 operation. A SQL tokenizer might be implemented using a recursive scanner over the original text; it is not impossible in principle, but it is substantially more complex than the UTF-16 key conversion and must be treated as a parser subsystem with differential tests, not assumed safe based on this probe.

## Minimal safe options for owner decision

1. **Recommended if semantic behavior may be scoped narrowly:** implement the ASCII UTF-16 key for all well-formed Unicode, while treating any JSON array text containing an escaped unpaired surrogate as unindexable/invalid in the catalog/filter path. To avoid silently lying, detect it against the raw JSON text before JSON1 decode and fail closed (or expose a diagnostic) rather than index U+FFFD. This requires confirming the API's error behavior and deciding how pre-existing such rows appear; it is a behavior change for the rare current JS-generated boundary value and must be owner-approved.
2. **If preserving all old parser outputs is mandatory:** retain raw JSON token extraction in the JS write path as an additional persisted safe key representation, and ensure every writer including arbitrary external SQL is covered. The stated unknown external SQL writers and trigger-only synchronization mean this cannot be guaranteed without changing the writer contract; no viable no-UDF SQL-only implementation was found.
3. **If full compatibility must include external SQL writers and no API/parser changes:** keep P2 unresolved unless an isolated, differential-tested SQL raw-token tokenizer can be shown correct and maintainable across migration, triggers, and filters. Existing SQL's astral mismatch is visible and preferable to irreversible false identity. Do not claim exact support or silently coalesce distinct JS strings.

In every option, a safe fallback should avoid destructive catalog merges: do not `INSERT OR IGNORE` different JS identities into the same U+FFFD `name`; do not allow a broken legacy-name filter to select a different tag; and do not rewrite `tags_json` as a convenience migration.

## Probe artifacts and execution

- `tag-unicode-sqlite-probe.py` — dependency-free, in-memory SQLite prototype. It compares a pure-SQL UTF-16 key conversion to JS-equivalent/Python UTF-16 code-unit expectations for BMP/astral boundaries, valid pairs, lone surrogate inputs as JSON escapes, Unicode trimming, non-string array members, and empty-after-trim. It runs under `python .trellis/tasks/10-19-ai-spending-organization/research/tag-unicode-sqlite-probe.py`.
- That probe passes on Python SQLite 3.50.4, where JSON1 exposes lone surrogate bytes. This is not proof for production.
- A direct Node probe using the installed `better-sqlite3` in `packages/server` verified runtime SQLite 3.53.2 and established that JSON1 replaces lone surrogates with U+FFFD. The exact snippets and observed results are recorded above.

## Recommendation

Do not start product implementation from the Python CTE result alone. First decide whether to build and maintain a SQL raw-token tokenizer or narrow the compatibility contract for unpaired surrogates. The current evidence proves the JSON1 extracted-value path is lossy on the app's SQLite 3.53.2; it does not prove that every possible hand-written SQL tokenizer is impossible. If pursuing the tokenizer, first build a separate differential prototype against JS `JSON.parse`/`parseTagsJson` on the bundled SQLite version, covering array strings, escaped pairs/lone surrogates, literal astrals, whitespace, nested/non-string members, malformed JSON, first-occurrence dedupe and limits. If the intended guarantee is ordinary well-formed Unicode only, approve the ASCII UTF-16 key design and explicitly decide lone-surrogate behavior before changing any product file.
