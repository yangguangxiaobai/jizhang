# Logging Guidelines — Backend

> pino, JSON to stdout. One decision matters more than the rest: **never log a secret or
> a ledger value.**

---

## Setup

`app.ts` constructs Fastify with `logger: { level: config.logLevel }`. `LOG_LEVEL` comes
from the environment (default `info`, validated against
`fatal|error|warn|info|debug|trace|silent` at startup — an invalid value stops the boot
rather than being ignored).

Output is newline-delimited JSON on stdout. In Docker that means `docker compose logs`,
and it is why nothing writes to a log file itself: the container runtime owns retention.

---

## Levels, and what each one means here

| Level | Used for |
|---|---|
| `fatal` | reserved (nothing currently) |
| `error` | a request failed with 5xx, or the process cannot start (e.g. `listen` failed) |
| `warn` | a request was rejected (4xx), or a route was not found |
| `info` | lifecycle only: `sqlite ready`, `jizhang server listening`, `login succeeded`, `password changed`, `shutdown complete` |
| `debug` | reserved for local investigation |
| `silent` | used by the test suites, so assertions are not buried in output |

Rule of thumb: **`info` for things an operator wants in a normal day, `warn`/`error` for
things that went wrong.** A successful request is not logged at `info`.

---

## The startup line is load-bearing

`index.ts` emits one structured record that carries the entire bring-up result:

```json
{"dbFile":"/data/jizhang.db","dataDir":"/data","migrationsApplied":[1],
 "backupPath":null,"categoriesInserted":8,"accountsInserted":1,
 "templatesInserted":1,"msg":"sqlite ready"}
```

This is the fastest way to answer "did it migrate?", "did it seed?" and "where is the
database?" from `docker compose logs`. On a second boot the counts are all `0` and
`migrationsApplied` is `[]` — which is exactly the idempotency evidence.

---

## What is deliberately logged

- **Live counts** on relevant events: rows inserted, sessions purged.
- **A reason code** for an authentication failure (`no-user`, `wrong-password`) — in the
  log only, never in the response.
- **The request/response pair** Fastify emits automatically (`reqId`, `statusCode`,
  `responseTime`). That is how you correlate an error record with the request that caused
  it.
- **The full error object** for unexpected failures (`request.log.error({ err: error },
  ...)`), which is the one place a stack is allowed to appear.

---

## What must NEVER be logged

- **Passwords** — plaintext, hashed, or as part of a request body dump.
- **Session tokens.** The database stores only a SHA-256 for exactly this reason; a log
  line containing the raw cookie would undo it.
- **`JIZHANG_PASSWORD_HASH`** or any other environment value.
- **Full transaction payloads.** The ledger is the user's private financial data. Log an
  id or a count, not amounts and notes.

The config module is careful here too: when validating the environment it reports *which
variables are missing*, never their values.

---

## Practical notes

| Topic | Guidance |
|---|---|
| Adding a log line | Put it on `request.log`, so it inherits `reqId` and the child logger |
| `console.*` | Only in the CLI, where there is no request context. Never in a route or service |
| Tests | Set `LOG_LEVEL=silent`; a test that needs to assert on output should assert on the response instead |
| Log volume on a resource-capped VPS | Keep an eye on it; the compose file caps `json-file` at 10 MB × 3 files. `LOG_LEVEL=debug` on a busy instance is not free |

---

## Forbidden patterns

- `console.log` in `src/**` outside `cli.ts` / `cli-db.ts`.
- Logging a request body wholesale.
- Logging a secret and then "redacting" it in the same message.
- Using `info` for per-request chatter — it makes real events unfindable.
- Emitting an error's `message` to the client while also logging it as `info` (the level
  should reflect that something went wrong).
