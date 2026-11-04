# DT Identity Service

> Backend runtime: NestJS 12 modular monolith on Node.js 24, with `oidc-provider` mounted natively through the Express adapter. See [docs/nestjs-architecture.md](docs/nestjs-architecture.md).

独立开发的 OIDC 身份服务项目，项目署名使用 **DT／东土**。实现仍在开发中，不可用于生产环境。

## 技术基线

- Node.js 24、TypeScript、NestJS 12（Express adapter）
- OIDC 协议由上游 oidc-provider 处理
- PostgreSQL 保存应用、协议状态、管理员会话和审核记录
- 账号库通过只读连接查询；Redis 提供登录限流、协议重放检测、门户登录事务存储与跨实例客户端缓存通知

## 当前实现

包含只读账号认证、OIDC 登录和授权同意交互、用户资料与授权管理页、`/api/v1/me` 当前用户资料 API、开发者 API 与 `/developer` 双语界面、AES-GCM 加密的 Web 客户端密钥生成与轮换，以及独立管理员应用/应用组审核页面、操作审计和状态统计。开发者界面支持开发者资料、应用草稿、审核提交、应用组申请和改名、删除未被应用引用的待审或已驳回组，以及密钥轮换；未登录时可从页面直接进入门户登录。已批准的 SPA/native 客户端使用公开客户端认证。

服务首页 `/`、开发者中心 `/developer` 与门户授权页 `/portal/authorizations` 已提供；门户使用 OIDC Authorization Code + PKCE 登录。可运行的 Web 客户端示例见 [examples/web-client](examples/web-client)，Native 客户端示例见 [examples/native](examples/native)。GitHub Actions 使用临时 PostgreSQL 17 与 Redis 7 执行存储集成检查。联系邮箱验证支持可选 SMTP 配置；实际 SMTP 投递、真实账号库和目标网络端到端验收、生产级升级迁移及目标环境综合验收仍待完成。API 路由见 [docs/api.md](docs/api.md)，部署步骤见 [docs/deploy.md](docs/deploy.md)，直接依赖许可索引见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，实施限制见 [docs/progress.md](docs/progress.md)。CI 归档生产依赖 SBOM，Dependabot 定期提出依赖更新。

## 检查

```sh
npm install
npm run check
npm run lint
npm test
npm run build
```

GitHub Actions 在每次分支更新时运行类型检查、Lint、前端/Web/Native 示例语法检查、单元/HTTP 测试、临时 PostgreSQL/Redis 存储集成测试与构建。

## 运行准备

1. 本地开发复制 `runtime/config.example.json` 为被 Git 忽略的 `runtime/config.local.json`，并填入账号只读库、OIDC 数据库、Redis、SMTP 及现有账号系统的 HMAC 密钥；若使用反向代理，仅在 `trustedProxyCidrs` 中列出实际代理网段。
2. 使用 `npm run keys -- --out runtime/signing.local.json` 生成本地签名材料；把生成的 cookie、fingerprint、subject、encryption 值填入本地配置。
3. 复制 `.env.example` 为 `.env.local`。`npm run dev` 会从该文件读取 `OIDC_CONFIG_FILE` 和 `OIDC_SIGNING_KEY_FILE`，默认指向上述两个本地文件。
4. 测试和正式环境不复制本地文件，也不提交环境专用 JSON；由部署系统挂载受保护配置和签名文件，并将两个环境变量设置为对应的绝对路径。
5. 本地执行 `npm run build` 后使用 `npm run migrate:local` 应用版本化数据库迁移，再运行 `npm run dev`。`development` 模式首次启动且管理员表为空时会创建 `admin / 123456`，首次登录后应立即更改；测试和正式环境不会自动创建管理员，迁移后使用已编译的 `npm run admin:create` 显式创建，再运行 `npm start`。本地显式创建可使用 `npm run admin:create:local` 自动读取 `.env.local`。

不要提交 `runtime/config.local.json`、签名材料、实际密钥、管理员凭据、数据库连接串或 `.env` 文件。仓库中的 `runtime/config.example.json` 只描述字段结构，不能直接启动服务。
