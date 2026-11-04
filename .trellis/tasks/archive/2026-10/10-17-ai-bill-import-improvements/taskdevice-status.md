# Android device install status — AI bill import improvements

Status: **INSTALLED / LIMITED LAUNCH SMOKE OBSERVED**  
Task: `.trellis/tasks/10-17-ai-bill-import-improvements`  
Device: `TNL0220A15028072` — Huawei nova7Pro family (`JER-AN20`), Android 12 / SDK 31  
Observed: 2026-10-19 UTC

## Authorization / scope

Read and followed:
- `research/deployment-install-authorization.md`
- `research/final-quality-readback.md`
- `research/android-identity-wire-fix.md`
- `C:/Users/QUIZ/.pi/agent/agents/phone-verifier.md`

The pre-existing task remains `in_progress`; no task was created/switched. This report only establishes data-preserving install identity and a non-writing `MainActivity` launch smoke. It is not full product or feature acceptance.

## Existing evidence checked first

Historical task `archive/2026-10/10-15-ai-streaming-interactive-dialogue/device-status.md` and its `artifacts/phone-verifier-scroll-final` evidence already recorded the previous install and data-preserving update. The current task's `artifacts/` directory was empty before this run. Existing local APK was **not rebuilt**; its prior test/lint/build evidence was retained as existing evidence (156 tests, 0 failures/errors; lint 0 errors/9 warnings).

ADB resolved from existing Android SDK at `C:/Users/QUIZ/AppData/Local/Android/Sdk/platform-tools/adb.exe`. `adb devices -l` showed the specifically authorized serial `TNL0220A15028072` as `device`. No other device was selected or targeted.

## Install and byte identity

- Before install: package `com.yansuu1.jizhang`, v0.1.0 / versionCode 3, `firstInstallTime=2026-10-10 08:54:23`, `lastUpdateTime=2026-10-17 01:04:23`.
- Installed signer certificate SHA-256 matched the target APK signer certificate SHA-256: `d41ce2befa2bef0fda935bae8334b4b63c73f4d1aa5cc35e3c60a1c10e89ed23`.
- Local APK: 18,473,623 bytes; SHA-256 `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`.
- Command: `adb -s TNL0220A15028072 install -r clients/android/app/build/outputs/apk/debug/app-debug.apk`
- Result: `Success`; exit code 0.
- Pulled installed `base.apk` through the post-install `pm path`; pulled file is 18,473,623 bytes, SHA-256 identical to local APK, and `cmp` reports `IDENTICAL`.
- After install: `firstInstallTime` remained `2026-10-10 08:54:23`; `lastUpdateTime=2026-10-19 13:29:41` (device local time). No uninstall or data clear.

## Launch smoke

Ran `adb -s TNL0220A15028072 shell am start -n com.yansuu1.jizhang/.MainActivity`. Android reported `Starting: Intent { cmp=com.yansuu1.jizhang/.MainActivity }`; subsequent activity and window diagnostics identify the resumed/focused `com.yansuu1.jizhang/.MainActivity`, and the app process was present. Captured a screenshot and UI hierarchy; the home screen rendered. A sampled package-scoped crash-marker scan returned zero matching FATAL EXCEPTION/ANR/force-finish markers. This is a short launch smoke only, not a guarantee of crash-free operation beyond the observation window.

No chat, bill import, model/provider request, financial confirmation, ledger mutation, settings change, or interaction with existing bill/session data was performed. During concurrent backend switching, any transient HTTP unavailability remains independently unclassified and was not used to label an Android UI bug.

## Evidence files

All new evidence is in `artifacts/merged-import-device-install/`:

- `01-preinstall-baseline.txt` — exact device list/identity, pre-install package metadata, local and installed APK identities.
- `02-preinstall-signer.txt`, `02-preinstall-apk-hash.txt`, `preinstall-base.apk` — pre-install APK/signer evidence. The APK is an application binary and is retained only as captured evidence.
- `03-install-result.txt` — exact command outcome and exit code.
- `04-postinstall-package.txt` — post-install version/path/timestamps.
- `05-pull-result.txt`, `05-apk-hashes.txt`, `05-byte-compare.txt`, `05-installed-signer.txt`, `installed-base.apk` — pulled artifact, hashes, exact byte equality and signer.
- `06-launch-result.txt`, `07-launch.png`, `07-launch.xml`, `07-ui-capture.log`, `08-launch-observation.txt`, `09-crash-scan-summary.txt` — bounded launch smoke evidence.
- `install-verification.json` — machine-readable summary.
- `progress.log` — execution progress.

## Conclusion and unverified scope

**Verified:** the requested APK was installed on the exact authorized serial using `install -r`; the pre-existing first-install timestamp remained unchanged; installed `base.apk` bytes and signing certificate matched the requested local artifact; `MainActivity` resumed and rendered during the observed smoke window.

**Not verified:** full AI bill import flows, provider behavior, backend deployment health, financial correctness, bill/session persistence across app sessions, broad crash-free behavior, and comprehensive feature acceptance. Existing test/lint/build figures are historical local evidence and were not rerun as instructed.
