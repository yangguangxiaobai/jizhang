# Source audit — Android UI planning, 2026-10-10

Scope: repository reads and documentation only. No product-code edits.

## Verified facts

Paths below are relative to `clients/android/app/src/main/java/com/yansuu1/jizhang/`, except Gradle.

- `clients/android/app/build.gradle.kts`: min26/compile34/target34, compiler1.5.14/BOM2024.06.00; Navigation Compose is commented out.
- `ui/MainShell.kt` enum Tab/MainShell: six entries; Record currently changes active tab to Transactions. Returning to source is proposed new behavior.
- `ui/MyTab.kt` section dispatch: settings/assistant/provider/salary/pending/items/manage/templates/recurring/transfers/trash/data.
- `ui/TransactionEditSheet.kt` payload: type/amountCents/categoryId/accountId/date/note/isRefund/tags/refundLinkedTxIds; preserve all.
- `ui/SalarySheet.kt`: create/update, history, salary detail and separate allocation replacement.
- `ui/ManageTab.kt` TemplatesTab: percentage ratios, default, apply current, delete; parent/child conflict is explicit.
- `ui/RecurringRulesTab.kt` freqLabel/RuleEditor: daily/weekly/monthly/quarterly/yearly and anchorDate.
- `ui/StatsTab.kt` reload: range/monthWindow/categoryShare/monthlyTrend/poolTrend; share-window and trend-months are independent.
- `ui/DataTab.kt`: exports transactions/salaries/recurring/transfers; imports transactions/transfers and separate platform files.
- `repo/PortabilityRepository.kt`: backups list/create, no client restore/download interface.
- `ui/ItemsTab.kt`: list/detail/edit/sell/retire/remove/photo/cutout; SettingsFull also lives here and must survive splitting.
- `ui/ProviderSettings.kt`: name/url/model/timeoutMs/headers/bodyTemplate/responsePath/headerName and mode/method/auth/secret semantics.
- `repo/AssistantRepository.kt`: conversation create/list/messages/send/archive, action confirm/cancel; no archived-history or persistent attachment recovery assumption.
- `ui/theme/JizhangTheme.kt`: Titanium/Forest/Mono, System/Light/Dark; current semantic colours are visual baseline.

Complete functionality-to-page matrix is in the design README §2. These are source facts, not physical-device acceptance claims.

## Provider API limitation found during UI implementation

The AI provider summary in packages/server/src/services/ai-config-service.ts, around lines 268–286, returns a null bodyTemplate whenever the saved mode is not custom. The Android editor keeps a draft while that settings page stays open and omits the unavailable field when saving other settings so it cannot erase a hidden server value. Recovering this field after leaving and reopening requires a separate server API change.

## Spec conflicts

Frontend index describes Web/iPhone hosting and an obsolete negative-expense refund model. Follow current shared/server contracts and `backend/native-delivery.md`: API-only and refund-as-income. CSS-only/iOS workarounds are not native Compose rules. Preserve truthful money, limited stagger, no idle decoration and reduced motion goals.

## External sources checked

- [Adobe twelve principles](https://www.adobe.com/creativecloud/animation/discover/principles-of-animation.html)
- [Android Compose animation](https://developer.android.com/develop/ui/compose/animation/quick-guide)
- [Android accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)

Mappings, durations/curves, page structure and performance gates are project proposals, not quotations or measured results. Harmony4, productionAI/cutout and actualplatform-file acceptance remain future work.
