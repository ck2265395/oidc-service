# Unified Identity Console Design

## Intent

将当前分散的公共首页、OIDC 登录授权、用户门户、开发者中心和运营后台统一为一套成熟的身份平台体验。目标用户包括普通账号用户、接入 OIDC 的开发者以及平台运营管理员。界面参考大型云平台控制台的信息密度与导航方式，但保持 DT Identity / 水月雨自己的简洁品牌表达。

## Goals

- 公共门户、认证流程、用户中心、开发者控制台和运营后台使用同一设计系统。
- 开发者能够登录后完成资料维护、邮箱验证、应用与应用组管理、审核提交和密钥轮换。
- 用户能够查看资料、已授权应用并安全撤销授权。
- 管理员能够审核应用与应用组、查询审计记录和查看统计。
- 前端与后端逻辑分离，当前支持单体部署，未来支持 CDN/独立前端部署和后端 cluster。
- 保留现有 OIDC、会话、CSRF、限流、审计和数据库安全边界。

## Non-goals

- 不改造水月雨账号库的数据结构或密码算法。
- 不在本阶段增加组织、多租户、计费、RBAC 编辑器和第三方社交登录。
- 不修改 `moondrop-service` 或 `moondrop-admin`。
- 不改变已发布的 OIDC issuer、协议端点或客户端标识语义。

## Constraints

- Node.js 24、TypeScript strict、Express、oidc-provider、PostgreSQL、Redis 保持不变。
- 私钥和运行配置继续由受保护文件提供；前端不得接触数据库或服务端密钥。
- 状态变更接口必须使用同源 Cookie、CSRF Token、Origin/Fetch Metadata 校验。
- 客户端密钥只显示一次，服务端不返回可恢复明文。
- UI 必须支持桌面与窄屏、键盘操作、清晰焦点和 reduced motion。

## Architecture Decision

采用“同仓库、独立前端、可拆部署”方案：

- `web/` 是 React + Vite + TypeScript 单页前端，拥有设计系统、路由与各角色控制台。
- `src/` 保持后端职责，认证协议和业务服务不迁移到浏览器。
- 后端新增 `/api/v1/session`、`/api/v1/portal`、`/api/v1/admin` 等 JSON 边界；开发者 API 延续 `/api/v1/developer`。
- Vite 输出到 `public/app/`，Express 当前直接托管并为前端路由提供 fallback。
- 生产环境以后可将 `public/app/` 发布到同源 CDN；若跨域部署则另行设计 BFF，不在本阶段放宽 Cookie/CORS。

## Considered Approaches

1. 继续服务端字符串拼 HTML：依赖少，但页面复杂度、复用、测试和长期维护不可接受。
2. 立即拆成两个仓库和两个域名：部署边界清晰，但会过早引入跨域 Cookie、CORS、发布编排和版本协调。
3. 同仓库独立前端、同源部署：既建立清晰边界，又保留最简单安全的同源会话。选择此方案。

## Information Architecture

- `/`：品牌首页、能力说明、三个入口与服务状态。
- `/sign-in`：用户/开发者统一登录入口；OIDC interaction 页面保持协议上下文。
- `/consent`：应用信息、申请权限与允许/拒绝操作。
- `/account/profile`、`/account/authorizations`：用户中心。
- `/developer/overview`、`/developer/profile`、`/developer/applications`、`/developer/groups`、`/developer/docs`：开发者控制台。
- `/admin/overview`、`/admin/applications`、`/admin/groups`、`/admin/audit`、`/admin/statistics`：运营后台。
- 未登录访问受保护页面时跳转到对应登录流程，并保留安全的站内 return path。

## Visual System

- 采用浅灰工作区、白色卡片、深靛蓝主色和状态色；拒绝大面积渐变与装饰性堆叠。
- 控制台由 64px 顶栏、240px 侧栏、内容面包屑和最大宽度工作区组成。
- 统一 Button、Input、Select、Badge、Alert、Table、EmptyState、Dialog、Skeleton、MetricCard。
- 中文为主，协议/安全术语保留必要英文；用户门户关键文案提供中英双语。

## API and Security

- 前端启动时获取 session bootstrap，其中包含角色、用户摘要和短期 CSRF Token。
- 所有 JSON 错误统一为 `{ error, message, requestId, details? }`；不回传堆栈和密钥。
- 管理员和普通用户会话仍隔离；开发者使用普通账号 OIDC 会话。
- 审核、密钥轮换、撤销授权和退出操作均需明确确认。
- API 返回分页、筛选和状态字段，UI 不依赖服务端 HTML。

## Testing and Acceptance

- 后端使用 Node test 覆盖 session、CSRF、权限、列表/详情/操作 API。
- 前端使用 Vitest + Testing Library 覆盖路由保护、表单、错误状态和关键操作。
- Playwright 覆盖登录、开发者建应用、管理员审核和用户撤销授权的核心路径。
- `npm run check`、`npm run lint`、`npm test`、`npm run build` 全部通过。
- 桌面和窄屏页面均进行真实浏览器截图验收。

