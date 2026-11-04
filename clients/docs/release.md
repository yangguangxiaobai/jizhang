# release.md — 发版手册（A13 / P2）

> 包名/bundleName 均为拟定（`com.yansuu1.jizhang`），终确认前可改一次；
> 签名材料永远用户本地保管，不入库。

## Android APK (2026-10-09 delivery)

| 项 | 规则 |
|---|---|
| applicationId | `com.yansuu1.jizhang`（拟定） |
| versionName | 与仓库根 `package.json` 的 `version` 同源（构建时自动读取，当前 `0.1.0`） |
| versionCode | 每次 release +1（当前 `3`；parity 任务记录每次 bump） |
| minSdk / targetSdk | 26 / 34（见 `versions.md`） |
| 签名 | 用户本地 `keystore.properties`（见 `keystore.properties.example`）或 `JIZHANG_*` 环境变量；无 key 材料时 release 包回退 debug 签名（仅形状验证，不可分发） |

```bash
# 生成 keystore（一次，异地备份！丢了=无法覆盖安装）：
keytool -genkeypair -v -keystore jizhang-release.jks -alias jizhang \
  -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties  # 填入真实口令（gitignored）

cd clients/android
./gradlew clean assembleRelease
# 产物：app/build/outputs/apk/release/app-release.apk
```

历史校验（2026-10-06 实测）：`clean` 后重打成功；`apkanalyzer manifest`
确认 `application-id=com.yansuu1.jizhang version-code=2 versionName=0.1.0`。

2026-10-09 本轮验证：JDK17 + Android SDK34，Gradle 的 testDebugUnitTest（9 项）、assembleDebug、lintDebug、assembleRelease、lintRelease 全部通过。输出 versionCode3/versionName0.1.0；debug 和 release APK 路径保持上述规则。后续审核修改需重新构建验收。Android15模拟器已完成登录、会话恢复、记账和预算变化的核心链路（父任务记录证据）；鸿蒙4真机及真实域名部署联调仍待验。

Current production origin: `https://jz.yansuu1.xyz`; custom origin is supported. Release has one launcher (`MainActivity`); the demo activity is debug-only and has no launcher icon. Release HTTPS remains required. The same APK targets Android and HarmonyOS 4; HarmonyOS 4 physical-device validation remains pending. Version code 3 is greater than the historical version 2. An existing installation can only upgrade with the same signing certificate. A release built without user-local key material uses the development certificate and must not be presented as a production-signed release. Preserve the original key outside Git for future upgrades.

## Harmony Hap（H5，CLI 已验证 2026-10-06）

| 项 | 规则 |
|---|---|
| bundleName | `com.yansuu1.jizhang`（拟定，与 APK 同名便于识别） |
| versionName / versionCode | 与上表同源（`AppScope/app.json5` 当前 `0.1.0` / `1`；发版时与 APK versionCode 对齐+1 规则见 parity 任务） |
| API target | 12 起（NEXT 基线，覆盖 5/6；`compatibleSdkVersion`/`targetSdkVersion` = `5.0.0(12)`） |
| IDE/SDK 基线 | DevEco Studio 26.0.0.851（`DS-261.x`）/ SDK HarmonyOS 26.0.0.105（API 26）；见 `versions.md` |
| 签名 | 无签名配置即产 **unsigned Hap**（仅形状/可重复构建验证）；DevEco 本地调试签名走自动生成；正式签名用户在 DevEco 内配置，**永不入库** |

```powershell
# Windows PowerShell（2026-10-06 实测 BUILD SUCCESSFUL）：
cd clients/harmony
$env:DEVECO_SDK_HOME = "C:/Program Files/Huawei/DevEco Studio/sdk"
& "C:/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.bat" --no-daemon assembleHap
# 产物：entry/build/default/outputs/default/entry-default-unsigned.hap（~0.73MB）
# 提示 "WARN: No signingConfig found for product default" = 预期（unsigned 形状验证，非失败）
```

IDE 方式（等价）：DevEco 内打开 `clients/harmony/` → `Build > Build Hap(s)`。
