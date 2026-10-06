# Implement — 适配鸿蒙和安卓两端（父任务）

执行顺序：A（Android）与 H（Harmony）可并行；P（parity）必须在 A、H 首轮可演示构建后执行。
依赖只看本文件文字，不由目录树隐含。

## A. Android Kotlin（子任务 `10-06-android-kotlin-native`）

- [ ] A0 工程脚手架：`clients/android/` Gradle 工程建仓（包名 `com.yansuu1.jizhang` 拟定），
  minSdk/targetSdk/Compose 基线写入 `clients/docs/versions.md`。
  验证：`./gradlew assembleDebug` 成功。
- [ ] A1 网络层（N1–N7）：baseURL 配置+记忆、CookieJar 持久化、CSRF 头、无 body POST 去 Content-Type、
  统一错误体+401 回登录、离线写报错。
  验证：对照 design §2.1 逐项点检；bodiless POST（generate）联调通过。
- [ ] A2–A12 功能页：按子任务 PRD A2–A12 分组实现（鉴权/账单/预算/周期/统计/主数据/数据/AI/物品/外观/导航）。
  验证：每组对照 `client.ts` 分组 + Web 页面行为点检。
- [ ] A13 release 包：签名配置（用户本地 keystore，不入库）+ versionCode 规则。
  验证：`assembleRelease` 可重复产出可安装 APK。

## H. Harmony ArkTS（子任务 `10-06-harmony-arkts-native`）

- [ ] H0 工程脚手架：`clients/harmony/` DevEco 工程建仓（bundleName 拟 `com.yansuu1.jizhang`），
  API target/IDE-SDK 基线写入 `clients/docs/versions.md`。
  验证：模拟器/实机点亮登录页。
- [ ] H1 网络层（N1–N7，同构）：http+cookie 持久化、CSRF、无 body POST 去 Content-Type、401、离线。
  验证：同 A1 点检表。
- [ ] H2–H4 功能页+图表：按子任务 PRD H2–H4 实现，原生绘制三图。
  验证：每组对照 Web 行为点检。
- [ ] H5 release Hap：签名配置说明 + versionCode 规则。
  验证：可重复产出可安装 Hap。

## P. 对齐与发版（子任务 `10-06-native-parity-release`，A、H 之后）

- [ ] P1 对齐矩阵：`clients/docs/parity-matrix.md` 建表（三端数字对照），同一账号同一周期逐项打勾。
  验证：AC-P1。
- [ ] P2 发版手册：`clients/docs/release.md`（包名/签名/version/构建命令/产物命名）。
  验证：clean 后重打一致（AC-P2）。
- [ ] P3 文档更新：README/DEPLOY 双端章节 + 新域名引用（等用户新域名）。
  验证：他人可按文档复现（AC-P3）。

## 全局验证命令（服务端/Web 回归面，不动代码只跑）

```bash
pnpm --filter @jizhang/server run typecheck
pnpm --filter @jizhang/web run typecheck
pnpm --filter @jizhang/server test        # 后端 e2e 装置是对齐矩阵的种子账本来源
```

原生侧验证命令写入 `clients/docs/versions.md`（Gradle/DevEco 各自命令），
不在本仓库根脚本里假设。

## 回滚点

- 本任务默认不动 `packages/*`；若联调需服务端配合，另立小任务，不顺手改。
- 客户端打坏只删包重打；签名丢失=无法覆盖安装，签名文件由用户异地备份（发版手册注明）。
