# 本地验证记录

日期：2026-10-30。源码基线：`bde9a18da5ef33567f52fb544f181479cd4aedf3` 加当前工作区。以下为本次命令执行结果，未使用原任务的历史测试数量代替。

| 命令 | 结果 |
|---|---|
| pnpm --filter @jizhang/shared build | exit 0 |
| pnpm --filter @jizhang/shared test | exit 0；12 files / 385 tests passed；无失败 |
| pnpm -r run lint | shared/server 均通过；exit 0 |
| pnpm -r run typecheck | shared/server 均通过；exit 0 |
| pnpm --filter @jizhang/server test --maxWorkers=2 | exit 0；47 files / 1025 tests passed；无失败；60.11秒 |
| pnpm --filter @jizhang/server build | exit 0 |
| ./gradlew.bat --no-daemon --offline :app:testDebugUnitTest :app:lintDebug :app:assembleDebug | exit 0；BUILD SUCCESSFUL，2分12秒；53 actionable / 6 executed / 47 up-to-date |
| ./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --rerun | exit 0；测试任务实际执行，BUILD SUCCESSFUL，20秒 |
| node .trellis/tasks/10-30-core-finance-simplification-review/evidence/api-probes.mjs | exit 0；隔离真实 API/窗口复核；输出见 api-probes.json |
| python ./.trellis/scripts/task.py validate .trellis/tasks/10-30-core-finance-simplification-review | implement.jsonl 4 / check.jsonl 5 个路径均通过 |

Android重新执行后的 XML 汇总：52 suites，518 tests，0 failures，0 errors，0 skipped。报告位于 `clients/android/app/build/test-results/testDebugUnitTest/`。

Android lint XML：0 error，43 Warning，26 Information。报告位于 `clients/android/app/build/reports/lint-results-debug.xml` 和对应 HTML。

Debug APK：`clients/android/app/build/outputs/apk/debug/app-debug.apk`，23,060,589 bytes，SHA-256：

```text
77D4E1F6172C0DE44955D68BBBB7404FE7B01C5007D6DE0BDE3C116843039006
```

首次把 GRADLE_USER_HOME 指向仓库根已有 `.gradle-cache` 时，离线构建因缺 AGP 8.5.2 失败。确认用户默认 Gradle 缓存包含该插件后，使用默认缓存完成以上门禁。该初始缓存问题不计为业务构建失败。

尚未执行本版本的设备安装/操作、生产数据修改或部署。自动化通过不意味着 review.md 中的客户端偏差已经修复。
