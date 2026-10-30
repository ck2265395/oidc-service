# DT Identity Service

独立开发的 OIDC 身份服务项目，项目署名使用 **DT／东土**。实现仍在开发中，不可用于生产环境。

## 技术基线

- Node.js 24、TypeScript、Express
- OIDC 协议由上游 oidc-provider 处理
- PostgreSQL 保存应用、协议状态、管理员会话和审核记录
- 账号库通过只读连接查询；Redis 提供登录限流、协议重放检测、门户登录事务存储与跨实例客户端缓存通知

## 当前实现

包含只读账号认证、OIDC 登录和授权同意交互、用户授权撤销页、开发者 API 与 `/developer` 双语界面、AES-GCM 加密的 Web 客户端密钥生成与轮换，以及独立管理员应用/应用组审核页面、操作审计和状态统计。开发者界面支持开发者资料、应用草稿、审核提交、应用组申请和改名、删除未被应用引用的待审或已驳回组，以及密钥轮换；未登录时可从页面直接进入门户登录。已批准的 SPA/native 客户端使用公开客户端认证。

服务首页 `/`、开发者中心 `/developer` 与门户授权页 `/portal/authorizations` 已提供；门户使用 OIDC Authorization Code + PKCE 登录。可运行的 Web 客户端示例见 [examples/web-client](examples/web-client)，Native 客户端示例见 [examples/native](examples/native)。GitHub Actions 使用临时 PostgreSQL 17 与 Redis 7 执行存储集成检查。联系邮箱验证支持可选 SMTP 配置；实际 SMTP 投递、真实账号库和目标网络端到端验收、生产级升级迁移及目标环境综合验收仍待完成。API 路由见 [docs/api.md](docs/api.md)，部署步骤见 [docs/deploy.md](docs/deploy.md)，实施限制见 [docs/progress.md](docs/progress.md)。

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

1. 复制 config.example.json 到受保护的配置路径，并填入账号只读库、OIDC 数据库、Redis URL、管理员摘要及现有账号系统的 HMAC 密钥；若部署在反向代理后，仅在 `trustedProxyCidrs` 中列出实际代理网段。
2. 使用 npm run keys -- --out <受保护路径> 生成密钥材料；把其中的 cookie、fingerprint、subject、encryption 值填入配置。
3. 设置 OIDC_CONFIG_FILE 和 OIDC_SIGNING_KEY_FILE，分别指向受保护配置和密钥文件。
4. 在隔离的 OIDC 数据库执行 sql/postgre.sql。
5. 执行 npm run build && npm start。

不要提交实际密钥、管理员凭据、数据库连接串或 .env 文件。服务依赖真实数据库和现有账号库配置；当前分支未完成生产部署验证。