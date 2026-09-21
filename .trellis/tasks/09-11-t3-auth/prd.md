# T3 认证与会话

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T2**(需要 `users` / `sessions` 表)。T4 依赖本任务。

## Goal

实现单账号登录、登出、改密码与会话校验,把所有业务接口保护在认证之后。

用户价值:记账数据是隐私,暴露在公网域名下必须要求登录;同时单用户场景不需要注册流程,要足够简单。

## Background

- **单用户**由父任务 D7 决定:无注册流程
- 认证方案见父任务 `design.md` §5:httpOnly + Secure + SameSite=Lax Cookie
  (不用 localStorage 存 JWT —— PWA 场景更怕 XSS 窃取)
- 参考项目用 JWT + `JwtAuthFilter`(`backend/.../security/`),本项目改为**服务端会话表**,
  因为单用户不需要无状态 JWT,而会话表能实现"改密码后旧会话立即失效"

## Requirements

### R1 密码存储

- 用 argon2id 哈希
- 绝不记录明文密码到日志
- 密码强度最低要求:长度 ≥ 8(单用户自用,不引入复杂的字符类要求)

### R2 初始账号创建(CLI,不进 HTTP)

- 提供 `node dist/cli.js set-password` 命令行工具:
  - 交互式读取密码(不回显),写入 `users` 表
  - 用户不存在则以 `JIZHANG_USERNAME`(默认 `admin`)创建
  - 用户已存在则更新密码哈希,并**删除该用户所有会话**(强制重新登录)
- 不在 `.env` 里放明文密码(父任务 design.md §7.3)

### R3 会话

- 登录成功 → 生成 32 字节随机 token,`sessions` 表存 **SHA-256 哈希**,下发原始 token 到 Cookie
- Cookie 属性:`httpOnly`、`Secure`(生产)、`SameSite=Lax`、`Path=/`、`Max-Age` 来自 `SESSION_TTL_DAYS`(默认 30 天)
- 会话过期由 `expires_at` 判定;过期会话按需清理
- 登出删除当前会话记录

### R4 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/auth/me` | 已登录返回用户名与会话过期时间;**未登录返回 401** |
| POST | `/api/v1/auth/login` | `{username, password}` → 成功下发 Cookie;失败 401 |
| POST | `/api/v1/auth/logout` | 删除会话并清 Cookie |
| POST | `/api/v1/auth/password` | `{oldPassword, newPassword}`;成功后**其他会话全部失效** |

### R5 认证守卫

- 一个 Fastify 插件/装饰器:保护所有 `/api/v1/**` 业务路由
- 例外白名单:`/api/v1/health`、`/api/v1/auth/login`
- 未认证统一返回 `401` 与 `{error:{code:'UNAUTHORIZED', message}}`
- 已认证请求把 `userId` 挂到 request 上供后续使用

### R6 CSRF 防护

- 写操作(非 GET)要求请求头 `X-Requested-With: fetch`,缺失则 403
- SameSite=Lax 已挡住跨站表单提交,这是第二层保险(父任务 design.md §5)

### R7 测试

- 密码哈希与校验(正确密码通过、错误密码失败)
- 会话过期逻辑
- 未认证访问业务接口得到 401
- 改密码后旧会话失效
- 登录失败**不区分**"用户不存在"与"密码错误"(避免用户枚举)

## Acceptance Criteria

- [ ] AC1 `node dist/cli.js set-password` 可创建/更新密码,且库中只有哈希、无明文
- [ ] AC2 正确密码登录返回 200 且 Set-Cookie 含 `HttpOnly` 与 `SameSite=Lax`
- [ ] AC3 错误密码登录返回 401,且响应体不泄露用户是否存在
- [ ] AC4 无 Cookie 访问受保护接口返回 401 JSON
- [ ] AC5 携带有效 Cookie 访问 `/auth/me` 返回用户名
- [ ] AC6 登出后原 Cookie 再访问受保护接口返回 401
- [ ] AC7 改密码后,**旧** Cookie 访问受保护接口返回 401
- [ ] AC8 会话过期后访问返回 401(单测用时间注入验证,不靠真等)
- [ ] AC9 写操作缺 `X-Requested-With` 头返回 403
- [ ] AC10 `/api/v1/health` 无需认证即可访问
- [ ] AC11 `pnpm --filter server test` 全绿

## Out of Scope

- 注册、找回密码、邮件验证、多租户 → 父任务 Out of Scope
- 第三方登录(OAuth)→ 不做
- 本地应用锁(PIN / Face ID)→ 父任务 Out of Scope(Web 端无对应能力)

## Technical Notes

- `token_hash` 只存哈希:库泄露时攻击者无法直接复用会话(design.md §3)
- 会话表用 `better-sqlite3` 同步 API,单用户并发极低,无需额外锁
- 参考项目 `backend/src/main/java/.../security/JwtUtil.java` 的密钥管理思路可参考,
  但本项目**不签 JWT**,`SESSION_TTL_DAYS` 取代 JWT 的 `exp`
- 时间处理:统一用 epoch ms 整数存库,避免时区歧义
