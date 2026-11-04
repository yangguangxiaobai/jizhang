# 取消 Web 与服务端解耦

## Goal
按父任务确认范围取消 Web，保留支持 Android 的独立 API。

## Requirements
- 阶段一：网站不提供 Web 页面，域名根路径及旧页面路径返回 JSON 404；源码仅作功能参考。
- 阶段二：安卓全量功能验收完成，必要合同测试已独立，删除 packages/web 与 Web 专用脚本、依赖和活跃文档引用；Git 历史与旧任务记录保留。
- Docker 不再打包 Web，服务端不再返回 SPA 回退页面。
- 保留 API、session/CSRF、健康检查、业务口径和历史数据。
- 同步脚本、依赖、合同测试和文档，保留功能验收依据。

## Acceptance Criteria
- [ ] 阶段一上线后，访问根路径、旧页面及旧静态文件不会返回 Web UI。
- [ ] 阶段二删除 Web 源码后，后端与 Android 的构建测试不依赖 packages/web。
- [ ] API-only 镜像健康检查和 JSON 404 正常。
- [ ] 无 Web 也能运行后端，相关回归通过。

## Dependencies
父任务 10-09-android-server-delivery 范围确认后补齐设计、实施计划、上下文并启动。

