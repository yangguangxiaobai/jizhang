# Device evidence

Huawei nova7Pro/HarmonyOS4.2 connected via SDK ADB. Replacement install retained data; lastUpdateTime2026-10-14 16:20:47 device local time. Main-session pulled public installed base.apk and verified byte equality with checked app-debug.apk (18,393,654bytes, SHA2568c065b36ed8f3547b87dc76a524d39c2b7ccbc6aafbd68f78d01eb728b144e9d).

Existing actual-device XML captures show new pending workspace and comparison source/candidate, exclude then return, search/scroll then return. candidate-check.json confirms actual candidate exists in predeploy snapshot, full note and account/category labels exactly match, rendered candidate count1. Return shows49selected review rows. Raw private financial XML/snapshot/APK evidence stays ignored under artifacts, not published.

Evidence supports actual current candidate rendering and exclude/return/search flow; it does not prove every category/note draft scenario. Multiple-page rendering absent because device candidate count1; automated coverage only. Keep/include restore, edited category/note round-trip, large-font, weak-network and live login-expiry navigation remain pending. No final import confirmation or real ledger writes. Deployment/install complete, device acceptance partial rather than blanket PASS.

### 2026-10-15 R7 user autonomy & Ardot UI device evidence
- Deployed updated backend container `jizhang:api-duplicate-review-20261015T032610Z` (image sha256 verified, database integrity and all 20 tables identical, consistent snapshot `jizhang-2026-10-15T03-26-56-335.db` retained).
- Installed updated debug APK on Huawei nova 7 Pro (HarmonyOS 4.2).
- Real device inspection on 59-row WeChat statement:
  1. "不可导入" blocker removed entirely.
  2. Filter chips show `全部 (59)` | `已选入 (49)` | `未选 (10)` | `疑似重复 (5)`.
  3. The 7 previously-blocked rule exclusion rows (e.g. 中性交易, 资金划转/理财, 充值提现) are now in `未选 (10)` with enabled checkboxes (`clickable=true`, `enabled=true`).
  4. Tested checking a previously-excluded row: selection count updated from `已选 49/100` to `已选 50/100`, chips updated dynamically to `已选入 (50)` and `未选 (9)`.
  5. Tested unchecking in `全部` list: selection count dropped back to `已选入 (50)` / `未选 (9)`, proving full bidirectional user autonomy.

