# Quality Guidelines — Backend

> Code quality standards for `packages/server`.
> Established by T1 (`09-11-t1-skeleton`); extended by later tasks as they land.

---

## Overview

The quality gate for every backend task is the same set of commands, run from the
repo root:

```bash
pnpm -r run lint        # eslint, --max-warnings 0
pnpm -r run typecheck   # tsc --noEmit (test config includes test/)
pnpm -r run test        # vitest run
```

Plus, for anything that touches the image or the process lifecycle:

```bash
docker compose build && docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
docker compose exec -T jizhang whoami          # must be `node`, never root
```

A task is not done while any of those is red. "It compiles" is not the gate.

---

## Required Patterns

- **Pure logic belongs in `packages/shared`.** The budget engine and money maths
  are pure functions with no IO so they are testable without a database, an HTTP
  server or a clock. A route must not re-implement a rule the shared package owns.
- **One aggregation rule, one implementation.** Net-expense semantics
  (`expenseContribution` / `incomeContribution` in `packages/shared/src/types.ts`)
  must be imported everywhere it is needed — budget, charts, summaries. Do not
  inline `type === 0 ? … : …` at a second call site; that is how the two copies
  drift apart.
- **Money is integer cents.** Every `*Cents` field is an `INTEGER`. Convert at the
  boundary only, and always with `Math.round(value * 100)` — `19.99 * 100` is
  `1998.9999999999998`.
- **Tests drive the app with `app.inject()`**, never a real port, so tests cannot
  collide or leak a listener.

---

## Forbidden Patterns

- `process.env.X` outside `config.ts`.
- `app.listen()` in `app.ts`, or a second Fastify instance anywhere.
- Returning HTML for any path under `/api`.
- A default value for a credential. Missing `JIZHANG_*` must abort startup with
  the aggregated `ConfigError` list (AC12), never a silent fallback.
- `--ignore-scripts` on a `pnpm install` that feeds the image, or removing
  `better-sqlite3` from `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Either
  one ships an image where the native addon is absent and `require` throws.
- Binding a container port to `0.0.0.0` or to `80`/`443` — see below.

---

## Testing Requirements

- Every rule that has a source-of-truth behaviour gets a test that names the
  behaviour, not the implementation. For the budget engine the reference project's
  21 behavioural cases are the spec (`research/budget-engine-behavior-spec.md`);
  they must all pass.
- Regression tests are named after the bug they prevent (see the `X1` case: month
  grouping must use an integer key because `'2026-12' < '2026-9'` as strings).
- Time is injected, never read from the real clock, so expiry/period logic is
  deterministic.

---

## Docker & deployment verification (T1 field notes)

These cost real debugging time. Keep them in mind before reporting a deployment
task as verified.

### Database snapshots MUST go through `VACUUM INTO`, never a file copy

The container runs SQLite in WAL mode, so recent commits live in the `-wal` sidecar
and are **not** in the `.db` file. `docker compose cp jizhang:/data/jizhang.db …`
therefore yields a **stale snapshot** — during T6 this produced an investigation
into a non-existent engine bug, because the copy contained data from an earlier test
run entirely.

Use the app's own consistent snapshot path:

```js
db.exec("VACUUM INTO '/tmp/snapshot.db'");   // includes everything in the WAL
```

The same rule applies to backups (design.md §7.4).

### Verify the numbers you assert, or you will "find" bugs that are not there

Three separate false alarms in T6 came from **hand-computed expectations**, not from
the code:

1. `listTags()` returned `[]` → the only tagged row had been soft-deleted a few lines
   earlier; the endpoint was right and the assertion was ordered wrong.
2. The carryover pool was `+450,000` where `-150,000` was expected → the expectation
   only subtracted one module's overspend and forgot that the other five modules were
   untouched. The pool is per-**cycle** net, not per-module.
3. The pool was `1,350,000` where `350,000` was expected → two cycles had closed, not
   one, so both left-overs belong in the pool.

Before changing engine code to match an expectation, recompute the expected value
from the raw rows (`SELECT` everything the engine reads) and state the arithmetic in
a comment next to the assertion. When a figure surprises you, dump the ledger first.

### `new Date()` is overloaded — name your month helpers by argument kind

`new Date(x)` treats `x` as an epoch timestamp; `new Date(year, monthIndex, day)` is a
calendar constructor. A helper called `startOfMonth(offset)` therefore silently does
two different things depending on the argument, and `new Date(0, -2)` is not "two
months ago" — it is November of year 0.

This bit the stats service: a month-bucket key computed from a month OFFSET instead of
the transaction's timestamp put every expense into the current bucket. The existing
tests missed it because they each used activity in a single month; only a row from an
earlier month reveals it.

Two rules:

- Name helpers after what they take: `startOfMonthOf(epochMs)` vs
  `monthStartOffset(epochMs, offset)`.
- **Every month-bucketing feature needs a test with data in at least two different
  months**, asserting that each row lands in its own bucket. Single-month fixtures
  cannot catch a wrong key.

### Integration scripts must not depend on "today" or on each other

Two rules, both learned by having suites fail only when run together:

**Time.** A salary dated more than a day in the future is rejected (deliberate: it
catches a mistyped year), so an e2e script that hard-codes a future month fails
purely because of when it runs. Derive dates from the current date going
**backwards** (`dayIn(-1, 5)` style).

**State.** Every suite must start from the same known baseline. `e2e-master-data`
renames the builtin 餐饮 category — that IS one of the things it verifies — and the
other suites then could not find it by name, so they passed alone and failed in
sequence. Each suite resetting only "the tables it cared about" was the root cause.

The fix is `packages/server/scripts/lib/e2e-reset.mjs`: it restores the seeded rows
and clears user data, and every suite calls `resetToKnownState()` first. It also
exposes `loadServerModule()`, which resolves `dist/` both from the repo and from
inside the image so the suites do not each hard-code a path.

**Verify independence explicitly**, not just "all green": run the suites in a
different order (or twice each) and confirm the counts do not change. `npm`-style
aggregate runners hide this class of bug because they stop at the first failure.

### Verify inside the container, from the package directory

pnpm keeps dependencies in the **owning package's** `node_modules`, not at `/app`.
A bare `docker compose exec jizhang node -e "require('better-sqlite3')"` fails with
`MODULE_NOT_FOUND` and looks like an ABI bug when the image is actually fine. Run
it with `-w /app/packages/server`, or assert the real thing instead: the server
logs `"msg":"sqlite ready"` with the resolved `dbFile`, which proves the addon
loaded in the actual runtime path.

### Build args and daemon state

- `docker compose build` needs a **running daemon**. On Windows that means Docker
  Desktop (and its `docker-desktop` WSL distro) being up; a stopped daemon fails
  with `failed to connect to the docker API at npipe://…`. Note that
  `docker ps -a` can still list stale exited containers, so it is not a health
  check for the daemon — use `docker version`.
- Docker writes progress to **stderr**, so PowerShell surfaces a successful build
  as a red `NativeCommandError` record. Judge by the build log and
  `docker images`, not by `$LASTEXITCODE`.

### Quoting inside `docker compose exec`

Nested quoting through PowerShell → docker → `node -e` mangles the script (single
quotes, `"`, even unescaped `!`). For anything beyond a one-liner, write the script
to a file, `docker cp` it into the package directory, run it, and remove it.

### Reverse-proxy coexistence is a hard constraint

`docker-compose.yml` publishes `127.0.0.1:8081:8081` and nothing else. The host's
existing Nginx/Caddy owns 80/443 and terminates TLS. Any change that widens this
binding can take down the user's other sites — treat it as a breaking change.

### A rebuilt image does NOT replace a running container, and the API does not serve the SPA

Two traps that both produce the same symptom — "my frontend change is not there" —
and both cost a full debugging round here:

1. **`docker compose up -d` is not enough after `docker compose build`.** Compose
   reuses the existing container when only the image changed, so the old layers keep
   serving. Use `docker compose up -d --force-recreate` after every rebuild whose
   contents you intend to verify. To check what is actually being served rather than
   what you built:

   ```bash
   docker compose exec -T jizhang cat /app/public/index.html | grep -o 'assets/index-[^"]*\.js'
   ```

   A stale hash against your host `packages/web/dist/index.html` is the proof.

2. **The Fastify server is what serves the built SPA**, so an API-level e2e suite can be
   entirely green while the deployed bundle is stale. `packages/web/dist` is baked into
   the image at build time; rebuilding the frontend therefore requires **rebuilding the
   image**, not just restarting the container.

Also note the container's `scripts/` directory does **not** exist in the image (the
Dockerfile does not copy it). Every `docker compose cp packages/server/scripts/. …`
must be repeated after any container recreation, or the suites fail with
`chdir to cwd … failed: no such file or directory`.

### Verifying a frontend change needs a browser, and the browser has a cache

`packages/web/scripts/render-dashboard.mjs` drives headless Chrome over the DevTools
protocol: it logs in over the API, sets the session cookie, loads the SPA, asserts the
dashboard's text, measures the rendered layout, and screenshots.

The static audit in `check-mobile.mjs` reads CSS **source** and cannot see a computed
size, a wrapped label, or a dangling sentence assembled from template fragments. The
browser script is where the 44px rule and "six tabs fit at 375px" get verified as
facts. It found a real UI defect on first run that every HTTP check had passed.

Two things to know when using it:

- **It needs a fresh profile.** The script points Chrome at a fixed
  `--user-data-dir`; a rerun can serve the previous build out of the HTTP cache and
  report the old DOM. Delete that profile directory before trusting a result.
- **`spawn(..., { stdio: 'ignore' })` is deliberate.** The sandbox cannot open named
  pipes, so capturing the child's output through a pipe fails with EPERM.

### `Network.emulateNetworkConditions` does not reliably cut the network

Do not verify the offline path with it. On the Chrome build used here it left
`navigator.onLine === true` and let `fetch('/api/v1/health')` return **200 with a real
body**, so the "offline" run was exercising a working network and every conclusion
drawn from it was noise. Two rounds went into reasoning about a caching bug that the
simulation had invented.

The render script therefore **stops and restarts the app service** for its offline check
(`docker compose stop/start jizhang`, inside a `try/finally` so a failing assertion cannot
leave the app down). The optional cutout worker is a separate private service; it is not
the browser's API origin and is not part of this outage simulation.

Whatever method you use, **make the outage prove itself** before trusting the result:
assert `navigator.onLine === false`, or that the fetch throws. A silent no-op simulation
reports whichever outcome you were hoping for.

### Container test inventory

Each suite calls `resetToKnownState()` first, so they are order-independent; verify
that explicitly rather than trusting it. Run each with, from
`/app/packages/server/scripts`:

| Suite | Focus |
|---|---|
| `e2e-auth.mjs` | login / logout / change-password / CSRF |
| `e2e-transactions.mjs` | CRUD, filters, soft delete |
| `e2e-budget.mjs` | the envelope engine over HTTP |
| `e2e-master-data.mjs` | categories, accounts, tags |
| `e2e-stats.mjs` | category share, monthly trend (income includes salaries), pool series |
| `e2e-home.mjs` | the dashboard's data contract: month figures agree with the charts page, cycle totals with the budget page, recents ordering |
| `e2e-trash.mjs` | the recycle bin: delete → bin → restore → purge, the 409 guard on live rows, bulk operations, and that `includeDeleted` keeps its old meaning |
| `e2e-periods.mjs` | historical cycle review: a past cycle returns its own figures, neighbours do not leak in, unknown periods 400, and the omitted path is field-for-field unchanged |
| `e2e-recurring.mjs` | recurring bills: due dates become pending (never bills), confirmation is idempotent, ignoring sticks, the backlog cap keeps the NEWEST periods and flags the rest |
| `e2e-portability.mjs` | CSV export/import: BOM on the bytes, round trip preserves count and totals, repeated import is a no-op, malformed files are refused whole, backups list without leaking a path |
| `e2e-pwa.mjs` | manifest, service worker, offline shell |
| `security-nopassword.mjs` | an unprovisioned instance is not loginable |
| `e2e-backup.mjs` | two-phase backup → stop → restore → start → assert drill |

### WAL and volume ownership

`journal_mode=WAL` means the SQLite file has `-shm` and `-wal` sidecars. Never copy
the `.db` alone for a backup (use `sqlite3 .backup`), and never assume
`docker compose down` removes the data: the named volume `jizhang-data` outlives
the container by design (that is AC9).

---

## Code Review Checklist

- [ ] Does the change put business rules in a service/shared package rather than a route?
- [ ] Are amounts integer cents, converted once at the boundary with `Math.round`?
- [ ] Is there exactly one implementation of the net-expense rule in play?
- [ ] Do unmatched `/api/**` paths still answer JSON, and client routes still get the shell?
- [ ] Was the container rebuilt and re-verified if the image contents changed?
- [ ] Did `lint` / `typecheck` / `test` pass after the last edit (not before it)?
