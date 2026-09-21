# Composables (Vue equivalent of hooks)

> This is Vue 3, so the React "hooks" file maps onto **composables** in
> `src/composables/`, named `useXxx`.

---

## What exists today

| Composable | Purpose |
|---|---|
| `useNetwork.ts` | connectivity state, the offline banner, and the iOS install hint |
| `useAuthStore` etc. | *not* composables — stores live in `src/stores/` (see state-management.md) |

---

## Naming and shape

- File and export both start with `use`: `composables/useNetwork.ts` → `useNetwork()`.
- A composable returns an object of refs (or `readonly` refs), never a bare primitive, so
  callers can destructure without losing reactivity by accident.
- Setup work belongs in the composable body or in `onMounted` **inside** the composable, so
  the caller does not have to remember to wire it up.

```ts
export function useOfflineBanner(): { readonly offline: ReturnType<typeof readonly<typeof online>> } {
  attach();                       // idempotent; see below
  const offline = ref(!online.value || lastRequestFailed.value);
  onMounted(() => { window.addEventListener('online', sync); ... });
  onUnmounted(() => { window.removeEventListener('online', sync); ... });
  return { offline: readonly(offline) };
}
```

---

## Module-scope state, with an idempotent attach

`useNetwork.ts` keeps `online` and `lastRequestFailed` at **module scope**, so every caller
sees one source of truth and the browser listeners are attached once. An `attached` boolean
guards against attaching them repeatedly when several components use the composable.

Use module scope when the state is genuinely global (connectivity is); use a `ref` inside
the function when each caller needs its own copy.

---

## Data fetching lives in stores, not composables

There is no `useTransactions()`-style fetch composable, deliberately. Server data is cached
in Pinia stores (`stores/transactions.ts`, `stores/budget.ts`, `stores/meta.ts`) so that two
pages showing the same data share one copy and one refresh path. A fetch composable would
create a second copy per component and they would drift.

See `state-management.md` for the store conventions.

---

## Every listener is removed

`onMounted` adds, `onUnmounted` removes. The browser keeps the listener otherwise, and the
component's closure (and its refs) leak with it.

---

## Common mistakes

- Returning a plain value instead of a ref, so the caller's template never updates.
- Attaching a window/`navigator` listener without a matching removal.
- Reaching for `window`/`navigator` at module scope, which breaks the module under
  `vitest`'s node environment. Guard with `typeof window === 'undefined'` — `useNetwork.ts`
  does this so it stays importable outside a browser.
- Putting server data in a composable instead of a store.
- Using a composable where a plain function would do. `utils/money.ts` is a module of pure
  functions, not composables, because it holds no state.
