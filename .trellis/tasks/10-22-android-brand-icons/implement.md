# 品牌执行清单（等待批准，不执行）

1. 读取[共同研究](../10-22-android-brand-recording/research.md)和现有Manifest、strings、ItemsTab.SettingsFull、ThemePrefs、Gradle签名配置；确认现有混合变更边界。
2. 将六张来源按序复制至永久素材目录，生成资源/预览并逐项核图，保留source与哈希，不把归档目录作为构建依赖。
3. 修改app_name及LoginScreen登录/会话检查标题的统一资源引用、默认application图标与6个稳定alias映射；保留MainActivity组件，移其LAUNCHER filter，默认仅6 enabled。
4. 实现可测试组件状态切换/恢复接口，API26先enable后disable，API33批量可选；状态回读确认后持久化。设置真实入口添加预览/选中/失败提示，不误改旧孤立SettingsTab。
5. 增加资源/Manifest mapping与状态fake测试：6映射/默认6/单入口、重复/无入口恢复、失败不误报成功、选择重启/升级保留。
6. 仅更新受影响功能目录P001和外观设置相关项及变更记录，不宣称真机已验。
7. 后续在clients/android执行`.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`；记录产物哈希与签名摘要。运行前需用户最终批准，当前禁止构建。
8. 授权后设备测试新装、六款切换、强停重启、覆盖升级/选择保留、Launcher缓存及固定快捷方式；保留未验项。未取得匹配证书不可承诺覆盖，不擅自安装/提交。

与首页/账单代码可分文件，但ItemsTab和功能目录更新需串行合并。回滚不清其他工作区改动，已发布alias需保兼容。
