# versions.md — 双端基线锁定（A0/H0）

> 来源：父任务 `implement.md` A0/H0。改基线先改本文件，再改工程。

## Android（`clients/android/`）

| 项 | 锁定值 | 说明 |
|---|---|---|
| compileSdk / targetSdk | 34 | 与本机 SDK `platforms;android-34` 对齐（2026-10-06 已安装） |
| minSdk | 26 | Android 8.0，主流机型全覆盖；鸿蒙 4（兼容 Android）可装 |
| build-tools | 34.0.0 | 本机已装 |
| JDK | 17 | 本机 `openjdk 17.0.2`；AGP 8.x 要求 JDK 17 |
| AGP | 8.5.x | 与 Gradle 8.7 配对（Gradle Wrapper 生成） |
| Kotlin | 1.9.24 | 与 Compose Compiler 对照表配对 |
| Compose BOM | 2024.06.00 | Material3 基线 |
| OkHttp | 4.12.0 | 网络层 N1–N7 实现 |
| DataStore | 1.1.1 | baseURL + 主题偏好持久化 |
| Room | 2.6.1 | 预留（在线优先，首版仅内存缓存；离线看壳不落库，如需再启用） |

包名：`com.yansuu1.jizhang`（拟定，终确认前可改一次）。
versionName 与仓库 `package.json` 同源（当前 `0.1.0`），versionCode 自增。

### Android 验证命令

```bash
cd clients/android
./gradlew assembleDebug          # A0 门：成功即过
./gradlew assembleRelease        # A13 门：需 release keystore（用户本地，不入库）
./gradlew lint                   # 质量门
```

## Harmony（`clients/harmony/`）

| 项 | 锁定值 | 说明 |
|---|---|---|
| IDE | DevEco Studio 26.0.0.851（`DS-261.23567.138.36.2600851`，2026-10-06 本机实测） | NEXT 开发唯一入口 |
| SDK | HarmonyOS 26.0.0.105（API 26）；`DEVECO_SDK_HOME=C:/Program Files/Huawei/DevEco Studio/sdk` | hvigor CLI 解析 SDK 用 |
| 编译目标 API | 12 起 | NEXT 基线，覆盖 5/6 |
| 验证矩阵 | HarmonyOS 5 × 6（模拟器或实机其一） | 鸿蒙 4 走 APK，不进 Hap 矩阵 |
| 语言/UI | ArkTS + ArkUI（声明式，不套 WebView） | 父 PRD R1 |
| 网络 | `@ohos.net.http` + Preferences cookie 持久化 | 对应 N1–N7 |

bundleName：`com.yansuu1.jizhang`（拟定，与 APK 同名便于识别）。
Hap versionCode 规则见 `clients/docs/release.md`（P2 产出）。

### Harmony 验证方式

CLI（2026-10-06 实测通过，首选可复现方式）：

```powershell
cd clients/harmony
$env:DEVECO_SDK_HOME = "C:/Program Files/Huawei/DevEco Studio/sdk"
& "C:/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.bat" --no-daemon assembleHap
# BUILD SUCCESSFUL；产物 entry/build/default/outputs/default/entry-default-unsigned.hap
```

DevEco 内（等价）：`Build > Build Hap(s)`；模拟器或实机点亮登录页（H0 门）。

## 服务端/Web 回归面（联调前必跑，不动代码）

```bash
pnpm --filter @jizhang/server run typecheck
pnpm --filter @jizhang/web run typecheck
pnpm --filter @jizhang/server test
```

> 注：本机 pnpm 需经 corepack 下载（2026-10-06 实测 registry 超时），
> 回归命令在网络恢复后执行；阻塞只记在此处，不卡 A0/H0 落盘。
