# Type Safety — Frontend

> `packages/web`. Strict TypeScript, plus one structural rule that does most of the work:
> the API layer is the only place that touches raw JSON.

---

## Compiler settings that shape the code

From `tsconfig.base.json`, applied to every package:

| Option | Consequence |
|---|---|
| `strict` | no implicit `any`, no unchecked null |
| `noUncheckedIndexedAccess` | **`arr[index]` is `T \| undefined`** — see below |
| `noUnusedLocals` / `noUnusedParameters` | an unused import fails the build |
| `verbatimModuleSyntax` | type-only imports must say `import type` |

### `noUncheckedIndexedAccess` is the one that bites

```ts
// WRONG: does not compile
const first = groups[0];
first.budgetCents;                       // Object is possibly 'undefined'

// RIGHT: guard once, then the narrowed value is usable
const first = groups[0];
if (first === undefined) return [];
first.budgetCents;
```

Do **not** reach for `arr[0]!`. The non-null assertion is not banned out of pedantry: every
`!` is an unchecked claim, and the whole point of the setting is to make you handle the
empty case. The budget engine carries several `if (x === undefined) return 0` guards that
exist purely because of it.

---

## The type boundary

`src/api/client.ts` owns the ONLY place JSON is parsed. It declares the wire shapes
(`Category`, `Account`, `Transaction`, `BudgetOverview`, …) and returns them typed:

```ts
export const api = {
  transactions: {
    list: (query: TransactionListQuery = {}) =>
      request<TransactionListResult>('/api/v1/transactions', { query }),
```

Views and stores consume those types and never re-declare them. When a server DTO changes,
exactly one file needs updating and the compiler lists every consumer.

> Do not mirror server types by hand in a second file. The budget engine already taught
> this from the other direction: two implementations of one rule drift, and the drift is
> invisible until the numbers disagree.

---

## Money and time are typed by convention, because the compiler cannot help

Nothing stops you passing a `number` of yuan where cents are expected, so the naming has to
carry the meaning:

- every money field is named `…Cents` (type and DB column alike),
- every timestamp is an epoch-millisecond `number`, named `date`, `…At` or `…Ms`.

Conversion happens only in `utils/money.ts`: `parseYuanToCents` (with `Math.round`) going
in, `formatCents` (integer arithmetic) coming out. A view that does `value * 100` itself is
a bug waiting for `19.99`.

---

## `unknown` at the edges, never `any`

`unknown` forces a check before use, which is the point:

```ts
function requireIntegerCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer number of cents.`);
  }
  return value;
}
```

Narrowing an untrusted array without lying about its type:

```ts
if (!Array.isArray(decoded)) return [];
for (const item of decoded) {
  if (typeof item !== 'object' || item === null) continue;
  const record = item as Record<string, unknown>;
  const categoryId = record['categoryId'];
  if (typeof categoryId !== 'string') continue;
```

A single documented `as` on a freshly-validated object is fine. An `as` on something that
has not been checked is not.

---

## Query parameters

`TransactionListQuery` is `Record<string, QueryValue>` with
`QueryValue = string | number | boolean | undefined`. Serialisation goes through one
`buildUrl` helper that drops `undefined` and empty strings, so no call site has to remember
to omit an absent filter.

---

## Forbidden patterns

- `any` — use `unknown` plus a guard.
- `as SomeType` on a value that was not validated first.
- `!` on an array index or an optional field.
- Declaring a second copy of a server DTO by hand.
- Money arithmetic outside `utils/money.ts` / `@jizhang/shared`.
- `@ts-expect-error` with no comment explaining why, and no plan to remove it.

---

## Checklist

- [ ] Does every new API response have a type in `api/client.ts`?
- [ ] Are indexed accesses guarded rather than asserted?
- [ ] Is every money field named `…Cents` and converted through `utils/money.ts`?
- [ ] Does `pnpm --filter @jizhang/web run typecheck` pass with no `any` added?
