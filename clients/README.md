# clients/ — 原生双端工程（与 `packages/` 平级）

Android 当前实际功能的维护入口：[完整功能 README](./android/README.md)。逐项记录页面、字段、操作、校验、API 和已知缺口；修改相关功能时必须同批更新。UI 设计方案另见 [UI 重构规划](./android/ui-redesign/README.md)，不能将规划当成已实现状态。

> Current delivery: `../.trellis/tasks/10-09-android-server-delivery/`.
> The earlier `10-06-harmony-android-adaptation` task is historical context.
> 本目录不是 pnpm workspace 成员（根 `pnpm-workspace.yaml` 只含 `packages/*`），
> `pnpm -r` 不会扫这里。

```
clients/
├─ android/   # 子任务 10-06-android-kotlin-native：Kotlin + Compose，产 APK（安卓主流 + 鸿蒙 4）
│  ├─ app/                 # applicationId com.yansuu1.jizhang（拟定）
│  │  └─ src/main/java/com/yansuu1/jizhang/
│  │     ├─ MainActivity.kt
│  │     ├─ net/ApiClient.kt   # 网络层 N1–N7 唯一 choke 点
│  │     └─ ui/theme/
│  └─ docs 旁见 clients/docs
├─ harmony/   # 子任务 10-06-harmony-arkts-native：ArkTS + ArkUI，产 Hap（鸿蒙 5/6）
│  ├─ AppScope/           # bundleName com.yansuu1.jizhang（拟定）
│  └─ entry/src/main/ets/ # EntryAbility + pages/Login + pages/Index（H0 壳）
└─ docs/      # 双端共享文档
   ├─ versions.md      # 基线锁定（A0/H0）：SDK/AGP/Kotlin/Compose、DevEco/API target
   ├─ parity-matrix.md # P1 对齐矩阵（待 A/H 首轮构建后填）
   └─ release.md       # P2 发版手册（待 P 批次）
```

## Current status (2026-10-09)

- Android uses configurable `https://jz.yansuu1.xyz`, versionName `0.1.0` /
  versionCode `3`. Debug/release build and lint passed, with 11 JVM regression
  tests. Without local release keys, the release variant is development-signed.
- Android 15 emulator evidence includes login, process restart/session recovery,
  tagged expense creation and budget change, logout and expired-session return
  to login, using an isolated synthetic backend. See the current task's research
  and `docs/parity-matrix.md` for checks and pending acceptance.
- Full feature replay, production HTTPS/data migration, configured AI/private
  cutout and physical HarmonyOS 4 coverage remain pending. The retired Web source
  has been removed from the workspace; Android acceptance remains independent.
- The 2026-10-09 public-domain check found health reachable but the root still
  serving the old Web image. The repository targets API-only hosting; these
  changes do not establish that production has been upgraded.
- Harmony build evidence from 2026-10-06 is historical; this round prioritizes
  Android. See `docs/versions.md` and `docs/release.md` for toolchain and signing.
