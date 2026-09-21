# T1 项目骨架与部署底座

> 父任务:`.trellis/tasks/09-11-web-pwa`(需求见其 `prd.md`,技术设计见其 `design.md`)
> 依赖:无。后续所有子任务依赖本任务。

## Goal

搭出可运行、可构建、可在容器里起来的 monorepo 骨架,并**在最初就验证容器内的 `better-sqlite3` 原生模块可用**。让后续子任务只需要往里填业务代码,不必再碰工程结构与部署配置。

用户价值:没有这一步,后面每个功能都无处落地;而原生模块 ABI 问题若拖到最后才发现,会同时阻塞上线和所有已完成的开发。

## Background

- 技术栈由父任务 `prd.md` 的 D1/D2/D3/D5/D6 决定:Vue 3 + Vite + TS / Fastify(TS)/ SQLite / Docker Compose / 1核1G-2核2G VPS 且与现有反代共存
- 架构选型见父任务 `design.md` §1(单容器,后端同源托管前端产物)与 §7(部署)
- 参考项目是 Flutter + Spring Boot,工程结构**不可照搬**;本任务是从零搭 Node 侧骨架

## Requirements

### R1 Monorepo 骨架

- pnpm workspace,含三个包:`packages/shared`、`packages/server`、`packages/web`
- TypeScript 全量严格模式(`strict: true`),三包共享一份基础 tsconfig
- 根脚本:`dev` / `build` / `test` / `lint` / `typecheck`,且能递归跑所有包

### R2 后端最小可运行

- Fastify 实例,监听 `0.0.0.0:8081`(容器内)或 `PORT` 环境变量指定端口
- `GET /api/v1/health` 返回 200 与 JSON `{status, version, uptime}`
- 环境变量解析与校验(`config.ts`),缺失必需变量时**启动即失败并给出清晰错误**,不静默用默认值
- 优雅退出:SIGTERM/SIGINT 时停止接收新请求并关闭连接
- Fastify 实例装配与 `listen` 分离(`app.ts` vs `index.ts`),便于测试里用 `app.inject()` 而非真起端口

### R3 前端最小可运行

- Vite + Vue 3 + TS,可 `build` 出静态产物到 `packages/web/dist`
- 一个最小页面,能调用 `/api/v1/health` 并显示结果(证明前后端连通)
- 开发态通过 Vite proxy 把 `/api` 转到本地后端,避免开发期跨域

### R4 后端托管前端产物

- Fastify 静态插件把 `packages/web/dist` 挂在 `/`
- SPA fallback:非 `/api/**` 的未匹配路径返回 `index.html`(供前端路由接管)
- `/api/**` 的 404 必须返回 JSON 错误,不能落到 index.html

### R5 容器化

- 多阶段 `Dockerfile`:builder 装依赖并构建三包 → runtime 只带 server 产物 + 生产依赖 + web 静态产物
- **两阶段使用同一基础镜像**(`node:22-bookworm-slim`),避免原生模块 ABI 不匹配
- 以非 root 用户运行
- `HEALTHCHECK` 调 `/api/v1/health`
- `docker-compose.yml` 只把端口发布到 `127.0.0.1:8081`,**绝不占用公网 80/443**(与现有反代共存)
- 数据目录通过卷挂载(本任务只建目录约定,schema 由 T2 落地)

### R6 代码质量基线

- ESLint(含 TS 与 Vue 规则)+ Prettier,配置在根,三包共用
- `.editorconfig` / `.gitignore`(排除 `node_modules`、`dist`、`data`、`.env`)
- `.env.example` 列出所有环境变量并附说明

## Acceptance Criteria

- [ ] AC1 `pnpm install --frozen-lockfile` 成功,生成并提交 `pnpm-lock.yaml`
- [ ] AC2 `pnpm -r run typecheck` 全绿
- [ ] AC3 `pnpm -r run lint` 全绿
- [ ] AC4 `pnpm --filter web run build` 产出 `packages/web/dist/index.html`
- [ ] AC5 `pnpm --filter server run build` 产出可执行的 `packages/server/dist/index.js`
- [ ] AC6 本地 `docker compose up -d` 后,`curl -fsS http://127.0.0.1:8081/api/v1/health` 返回 200
- [ ] AC7 **容器内 `better-sqlite3` 可用**:`docker compose exec jizhang node -e "require('better-sqlite3'); console.log('ok')"` 输出 `ok`(父任务 implement.md 的风险检查点 R1)
- [ ] AC8 浏览器打开 `http://127.0.0.1:8081/` 看到前端页面,且页面上显示的 health 结果为成功
- [ ] AC9 `/api/v1/nonexistent` 返回 JSON 格式的 404,而不是 HTML
- [ ] AC10 `docker compose down && docker compose up -d` 可重复成功(幂等)
- [ ] AC11 容器以非 root 用户运行(`docker compose exec jizhang whoami` 不是 `root`)
- [ ] AC12 缺必要环境变量时,启动日志给出明确错误(不是晦涩堆栈)

## Out of Scope

- 任何业务表与迁移 → T2
- 认证 → T3
- 真实前端页面与路由 → T4 及之后
- 线上 VPS 部署、HTTPS、备份 → T10(本任务只保证本地容器可跑)

## Technical Notes

- **原生模块要点**:`better-sqlite3` 是 C++ 扩展。`pnpm install` 不能加 `--ignore-scripts`(会跳过编译);builder 与 runtime 的 Node 主版本与 libc 必须一致。若改用 `node:22-alpine`(musl),prebuilt 二进制可能缺失而需要编译工具链,故这里选 `bookworm-slim`(glibc,prebuilt 可用)。
- **1G 内存考量**:镜像内不保留 devDependencies;可在启动脚本加 `NODE_OPTIONS=--max-old-space-size=256`。
- **不要在服务器上构建**:T10 会把本地构建好的镜像推上去或本地构建后传产物;本任务只需保证 `docker build` 在本地可行。
- 参考项目 `backend/deploy/docker-compose.yml` 是 Spring 版,仅可参考"用 `.env` 传密钥"这一点,其余不可照搬。

## 完成后要写回 spec(父任务 AC11)

本任务会定下 monorepo 目录约定、TS/ESLint 规则、Docker 构建方式。
Phase 3.3 必须把这些写进 `.trellis/spec/frontend/directory-structure.md`、
`.trellis/spec/backend/directory-structure.md`,替换占位模板内容。
