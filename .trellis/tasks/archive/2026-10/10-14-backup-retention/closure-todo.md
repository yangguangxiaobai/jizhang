# Scoped closure TODO

- [x] Load both task artifacts/reviews and inspect working-tree ownership.
- [x] Establish backup baseline-owned.diff is empty; backup tracked hunks are task-owned.
- [x] Detect import baseline dependencies not in HEAD; stop import commit/archive rather than include unrelated API/Android work.
- [x] Persist sanitized closure/spec; exclude private evidence locally without deleting it.
- [x] Rerun backup local gate; compare reviewed executable hashes.
- [x] Scoped backup work commit b7e9f26; explicit archive/journal paths, no broad auto-stage.
- [ ] Import commit/archive BLOCKED pending separate prerequisite ownership resolution.
- [ ] Duplicate-review planning creation waits for BOTH archives; do not create/start/implement yet.
