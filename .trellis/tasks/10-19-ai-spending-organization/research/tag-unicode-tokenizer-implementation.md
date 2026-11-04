# Tag Unicode SQL tokenizer — backend implementation report

**Active task:** `.trellis/tasks/10-19-ai-spending-organization`  
**Scope:** standalone tokenizer/helper and runtime differential proof only. This is not an integrated migration/API fix.

## Implemented

- Added `packages/server/src/services/tag-sql.ts`, exporting `rawTagTokensSql(expression, prefix)`. The recursive SQL CTE scans original JSON source text, tracks nesting, quoted strings, and backslash escaping, and returns raw escaped token bodies for only direct string members of valid top-level arrays. It does not use JSON1-decoded values, so `\\ud83d` is retained as ASCII escape text rather than becoming U+FFFD.
- Added `packages/server/test/tag-sql.test.ts`. It asserts the bundled runtime reports SQLite **3.53.2**, and differentially compares SQL-extracted tokens decoded with JavaScript `JSON.parse` against direct `JSON.parse` results. Cases include lone surrogates, escaped pairs, backslash/quote/slash/control escapes, astral and BMP literal Unicode, nested arrays/objects, non-string elements, empty arrays, malformed JSON, and non-array JSON.

## Runtime proof

Command: `cd packages/server && pnpm exec vitest run test/tag-sql.test.ts`  
Result: passed, 1 file / 1 test, on better-sqlite3 bundled SQLite 3.53.2.

## Not integrated / acceptance criteria still open

The helper proves raw token extraction only. It does **not** yet SQL-decode every token into JavaScript UTF-16 units, apply JS-exact Unicode trim / `.slice(0,32)` / first-occurrence dedup / 20-tag cap, construct canonical ASCII identity keys, or produce safely escaped name JSON for the catalog. Therefore it is not yet suitable for use by migration 013, catalog insert/update triggers, or transaction filters. Existing `name` TEXT storage and equality remain unchanged, and end-to-end preservation of lone surrogates is not claimed.

No migration/service/API files have been changed. No existing tag behavior is claimed fixed. The next integration gate is a second SQLite 3.53.2 differential test that verifies the SQL fragment's complete canonical entries against JS `parseTagsJson` + UTF-16 keys, including trim code points and surrogate-boundary truncation. Only after that passes should the migration/schema, triggers, service DTO decoding, and ASCII-key filter be switched together.

## Verification

- `cd packages/server && pnpm exec vitest run test/tag-sql.test.ts` — passed (1 file / 1 test) on SQLite 3.53.2.
- `cd packages/server && pnpm run lint` — passed.
- `cd packages/server && pnpm run typecheck` — passed.
- Full server tests and integration checks were not run; no product call sites have been switched to this helper.
