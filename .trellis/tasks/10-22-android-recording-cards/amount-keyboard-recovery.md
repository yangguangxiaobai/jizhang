# Amount keypad recovery — 2026-10-26

## User-approved bug fix and boundary

User reports entering note/other IME text before amount makes the custom amount keypad inaccessible. This is a follow-up correction to the existing recording task, not the pending Provider-model discovery feature.

Root cause in TransactionEditSheet: noteFocused/tagsFocused hide AmountKeypad, but AmountDisplay is a non-interactive readout with no focus transfer action. Hiding the system IME alone does not clear text focus. There is no explicit route back to amount input.

Minimal fix: wire the existing AmountDisplay FinanceCard click to clear Compose focus (force=true) and hide the software keyboard. Existing onFocusChanged callbacks remain the source of actual focus state and restore the numeric keypad. Add a visible tap hint, including compact layouts. No manual fake focus flags, timers, duplicated keyboard state, amount/draft resets, API changes or navigation changes. Preserve note/tag editing and existing numeric input/validation/save/refund behavior.

Expected changed files: TransactionEditSheet.kt (behavior), a scoped JVM source-wiring regression test (guard click/focus/IME wiring; not device evidence), clients/android/README.md (L04.03/L04.06 and change log), this record. Existing FinanceCard click implementation is reused. No new main-source file or dependency needed.

## Focus invariant for future changes

Keyboard visibility and text focus are different states. A text-focused custom-keypad screen must always expose a non-text action that clears actual focus to return to keypad mode. Do not merely hide the IME or manually set noteFocused/tagsFocused to false while the input still owns focus. Keep focus callbacks authoritative and make the return action available even with an empty amount and compact layout. Source-wiring guards prevent losing this action but cannot establish physical IME behavior.

## Final local results

- `gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain`: BUILD SUCCESSFUL.
- 26 suites / 275 JVM tests; zero failures/errors. Includes 3 new source-wiring guards, not actual Compose or IME gesture tests.
- lint: 0 errors, 43 baseline warnings. Scoped git whitespace check passed.
- Independent read-only scoped review: no verified blocking issue. Persistent compact hint adds one line; measured tiny-height and IME-animation behavior remains device acceptance, not proven by source.
- APK: `clients/android/app/build/outputs/apk/debug/app-debug.apk`, 22,219,528 bytes; SHA256 `2BBF679B32FBFD81908E0FA61848ED9AF9DF61CC64AB62ABF6D850601161146B`.
- ADB: no connected devices. No installation, remote deployment, server changes or commits performed.

Validation: Android JVM tests, lintDebug and assembleDebug; independent scoped source review; check connected devices. Real note-first/tag-first, IME dismissed-but-focus-retained, repeated amount/text switching, small-screen/large-font and ROM input-method behavior require device acceptance. No installation/deployment/commit authorized by this fix.
