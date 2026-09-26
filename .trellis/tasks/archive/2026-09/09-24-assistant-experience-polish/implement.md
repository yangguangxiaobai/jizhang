# Implementation plan

1. Update `AssistantView.vue` with persistent, always-discoverable conversation history and
   localized/structured confirmation-card fields. Preserve existing import and write-confirm
   behavior.
2. Add an AI assistant CTA to the top of `DashboardView.vue` using existing design tokens and
   `AppIcon`.
3. Extend the assistant browser mocks/tests to cover history switching/reload, transaction card
   readability, and the home CTA; keep the 375px layout checks.
4. Run targeted E2E plus `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, web build/PWA
   budget, and `git diff --check`. Inspect the final diff and do not commit or deploy unless
   requested separately.

## Rollback

All changes are additive view/test changes. Revert only this task's touched files if a UI change
breaks the existing assistant import or confirmation flows; no database rollback is needed.
