# Phase1 Device / Release Acceptance — Pending

No item passed by source, JVM test, build or parent planning review alone. Record device model/OS/API, APK SHA256, backend build/schema, locale/font/timezone, actual steps/result and evidence path when executed. Do not use production data for destructive fixtures. Installation and live deployment require separate approval.

## Navigation and drafts

- [ ] Five visible bottom positions unchanged; central plus opens action not persistent tab.
- [ ] Home category/purpose switch persists through tab return and process restart; new server/user does not inherit another scope's data or pending operation. Internal financial segments do not change home preference.
- [ ] Home/My financial links open one shared host/config. No double title or outer-return bypass. Category/financial/manual segment change, top back, system back and My return all obey dirty/busy/unknown-result guard.
- [ ] Salary round trip restores active host segment/cycle/scroll; cancel does not create a financial period or second salary.

## Salary and execution

- [ ] Enable explicit config; save10,000 salary; prompt shows2,500/1,500/5,000/1,000 and no-transfer statement. Skip preserves salary and creates no financial plan.
- [ ] Confirm shows exact source/date window and separate legacy envelope reference mismatch, not new account balances.
- [ ] Second salary same group creates new revision of same period and does not adopt changed ratios; source edit/delete gives explicit reconciliation, old decision inspectable.
- [ ] No period, disabled, old-server unsupported, auth expired and transient network failure are distinct; failures in financial card do not erase ledger/real balances.
- [ ] Growth/reserve say not connected/unknown actual flow, not completed/simulated savings. Manual forecast remains clearly hypothetical.

## Purposes and refunds

- [ ] Optional purpose choice in new/edit bill: inherit/essentials/joy; field clear and cancel work, no unintended category/account change. Expense→income clears inappropriate override.
- [ ] Category parent/child map and explicit unresolved rule display provenance; frozen old topology does not move after category changes until explicit restatement.
- [ ] Refund save followed by split confirmation shows partial success honestly; cancel/failure leaves saved refund pending, never claims rollback of bill.
- [ ] Exact multi-original split with cents, insufficient residual and stale source conflicts; page permits choosing originals beyond legacy links; cross-purpose/cross-cycle detail follows original.
- [ ] Soft delete/restore and bulk actions change gross/net consistently, restored split requires reconfirmation; missing/purged source warns rather than credits money.

## Weak network / process lifetime

- [ ] Block response after committed salary/period/override/split save; full immutable request persisted before send, restart recovers same operation/result without duplicate. Different action cannot overwrite unknown pending operation.
- [ ] Kill process between local pending persistence and server request; resume allows exact operation lookup/replay,404 operation alone not assumed proof of noncommit.
- [ ] Successful save followed by refresh failure displays committed success + refresh error, not a fresh unsaved action.
- [ ] Fast period/server/account change and late response do not cross scopes; auth loss stops writes and hides old data. Cancellation does not get swallowed as ordinary empty state.

## Layout and accessibility

- [ ] API26 and modern Android; small screen, landscape, large font, dark theme and reduced motion.
- [ ] TalkBack reading order includes purpose labels, net/gross/refund distinctions and unavailable state; touch targets>=48dp.
- [ ] Remarks/tags IME ↔ amount keypad switching preserves draft; purpose and refund original selectors do not hide amount/save controls.
- [ ] Long category/account names, very large safe amounts, negative remaining, empty/pending tables and paginated sources/refunds are readable without clipping.

### 2026-10-27 device-reported regression follow-up

Pre-fix SDK-adb reproduction on HUAWEI JER-AN20: execution 查看 did not open; invisible scenario consumed visible budget swipe; only header/tabs exposed by UIAutomator on execution. Old manual scenario still showed saved r3; no financial data changed. Evidence and repair gate: followup-ui-repair.md.

- [ ] Updated APK: execution refund 查看 opens review list, close works, no split submission.
- [ ] Updated APK: refresh control visibly responds and returns to current no-period/success/error state.
- [ ] Updated APK: category budget vertical swipe moves visible content; period selection works without changing data.
- [ ] Updated APK: history entry opens, empty confirmed-period state distinguished from saved manual scenario; close/back works.
- [ ] Updated APK: scenario retains saved plan and scroll/draft state through tab switches; no hidden page consumes active gestures.
- [ ] Populated history, multiple revisions, pagination, stale responses and weak-network retry verified separately (fixture/JVM evidence is not populated production-device evidence).

## Release evidence

- [ ] Record actual automated gate status separately from device result; no source-only fixture called touch/IME proof.
- [ ] Backend capability deployed before new APK only after approval; preserve existing DB volume/keys, verified backup/isolated restore and old v1 API.
- [ ] Old backend + new APK gracefully disables execution while existing manual and ledger functions remain usable.
