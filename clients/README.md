# clients/ — 原生双端工程（与 `packages/` 平级）

> 总纲：父任务 `../.trellis/tasks/10-06-harmony-android-adaptation/`（`prd.md` / `design.md` / `implement.md`）。
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

## 本批状态（A0/H0/A1-Android/H1–H4-Harmony/P1–P2 parity+release）

- ✅ Android `assembleDebug` 成功（`app-debug.apk` ~9.3MB），网络层 `ApiClient.kt`（N1–N7）已落盘待联调；
  `assembleRelease` 可重复产出（`app-release.apk` ~10.7MB，2026-10-06 last-known-good，versionCode 2 / versionName 0.1.0）。
- ✅ Harmony hvigor CLI 构建成功（2026-10-06 实测 `BUILD SUCCESSFUL`）：
  `entry/build/default/outputs/default/entry-default-unsigned.hap`（~0.73MB，unsigned 形状验证）。
  功能页 H2（鉴权/账单/预算/周期/统计/主数据/数据/AI/物品/外观/导航）+ H4（`Charts.ets` 原生三图）已落盘待联调。
- ✅ 对齐矩阵 `docs/parity-matrix.md`（P1）与发版手册 `docs/release.md`（P2）已就绪；
  基线 `docs/versions.md` 已锁定 DevEco 26.0.0.851 / SDK 26.0.0.105（API 26）+ CLI 命令。
- ⏳ 待新域名 + 真机/模拟器联调：三端同账号同周期数字截图（parity 矩阵 🔶→✅），登录→记一笔→预算已用链路演示。
- ⏳ `pnpm` 回归面因本机 corepack 下载 registry 超时暂缓，网络恢复后补跑（见 `docs/versions.md` 注）。
