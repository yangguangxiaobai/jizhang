# 六款图标设计（待批准）

## 方案与边界
复用MainActivity；新增6个稳定命名activity-alias指向它，仅第6默认enabled；移除MainActivity自身MAIN/LAUNCHER filter但保留组件可启动，避免升级旧组件身份丢失。application icon也指向默认6，aliases分别独立icon/label（必要roundIcon以平台支持为准）。不引入插件或新依赖。

设置入口为MyTab→ItemsTab.SettingsFull；选择器展示6图并以PackageManager有效状态核对本地持久化选项，后者不能单独冒充实际成功。候选LauncherIconController/Prefs等为新模块，实施时依现有ThemePrefs约定定名。

名称统一引用app_name资源，包括[登录及会话检查标题](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt#L85)与[登录页标题](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/LoginScreen.kt#L170)，避免桌面已改名但登录仍旧名。

## 切换与迁移
1. 读取有效别名，未选/初装默认6；已选用户升级优先保留，不被默认6覆盖。
2. API33+可批量组件状态；API26–32先启用目标再禁用其他，DONT_KILL_APP；成功回读后更新选中。非原子旧平台短暂重复不等于稳定多入口，设备实测要记录。
3. 恢复策略至少保证一个目标enabled，遇异常提示并回读有效状态；不先禁所有入口。用户重入时对异常多enabled做可解释归一。
4. 保留别名名称不随版本重命名；缓存/固定快捷方式旧图标可能延迟，不能声称代码保证即时。

## 素材与兼容
[父研究](../10-22-android-brand-recording/research.md)给出附件原顺序与规范化副本哈希。实施后将来源复制至永久App素材位置，并生成各密度legacy、圆形与adaptive foreground/background，保留内容/颜色；预览各种mask安全区避免裁字。构建不得读取任务目录。
已有release配置无密钥时fallback debug签名，必须比对实际已装包和候选产物证书摘要后才称覆盖兼容；不得输出秘密或重置证书。

## 备选与回滚
单静态图标不满足六款要求；运行时替换资源不适用标准Android安装包。alias是范围内可行方案。回滚需保留已引用组件或兼容桥，不可简单删选过的alias造成桌面死链；仅回滚本轮差异。
