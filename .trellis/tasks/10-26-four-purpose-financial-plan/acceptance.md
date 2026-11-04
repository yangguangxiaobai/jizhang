# First-release acceptance checklist

## Core fixtures

- I=1000000,C=500000,E=0 cents: allocations250000/150000/500000/100000; target2500000; gap2500000; ETA17; month12 reserve1800000/growth3000000, not actual balance.
- C differs from I/2: target follows C*5, not fixed spending allocation. C>I warns deficit and hypothetical feasibility; C>I/2 warns essentials budget shortfall.
- E>target preserved, progress capped for display, gap0/surplus positive/ETA0, new contributions still hypothetical after goal.
- tiny income (1..100 cents): allocations nonnegative, total conserved, stable tie resolution; zero reserve allocation yields null ETA unless goal already met.
- All input/derived numbers safe integers; BigInt intermediates do not serialize as JSON bigint; invalid input/corrupt saved envelope cannot become default or overwrite.

## Persistence/API

- Empty GET plan null; preview does not write even settings; save only financial.plan.v1. Old unrelated data byte-projections unchanged.
- expectedRevision0 create, next revision increments, immediate exact retry previous revision returns same result; different/stale409. Same-value current revision re-save may increment according to implementation but exact request replay remains safe.
- Auth/CSRF including preview. Corrupt/unsupported stored version unavailable, never reset silently.

## Android

- Entry reachable independent of budget load success/empty state, hides bottom bar, returns without resetting budget unnecessarily.
- Loading/error/empty/loaded/preview/dirty/pending save/conflict states distinguishable. Editing invalidates old preview; saved figures never presented as current edited input.
- Manual reserve0 valid, salary and essentials strictlypositive2decimal; no automatic account/salary sourcing. Save/read back server timestamps/revision.
- Unknown save can retry same immutable expectedRevision+input payload; no editing until outcome reconciled. Conflict reload explicitly warns discarding draft.
- Guidance contextual and educational, no specific investments or assumed gains. 12month growth only planned contributions, reserve forecast not actual; deficits do not suggest feasible automatic savings.
- Core prompts: safety under1month, essentials>50, essentials>income, liquidity24h/principal risks, high-interest debt/variable income,7day cooling, replenish and goal advice. Fixed texts, no AI dependency.

## Device gap

Do not infer screen/IME/TalkBack/large-font/weak-network acceptance from compile/JVM. No live production/config/bank/provider mutation or installation authorized by this implementation turn. Deliver both APK/backend bundle after checks.
