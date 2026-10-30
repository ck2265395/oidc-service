# DT Identity Service

独立开发的 OIDC 身份服务项目，项目署名使用 **DT／东土**。实现仍在开发中，不可用于生产环境。

## 技术基线

- Node.js 24、TypeScript、Express
- OIDC 协议由上游 oidc-provider 处理
- PostgreSQL 保存应用、协议状态、管理员会话和审核记录
- 账号库通过只读连接查询；Redis 跨实例集成尚未完成

## 当前实现

包含只读账号认证、OIDC 登录和授权同意交互、用户授权撤销页、开发者应用与应用组管理 API、AES-GCM 加密的 Web 客户端密钥生成与轮换，以及独立管理员应用/应用组审核页面、操作审计和状态统计。已批准的 SPA/native 客户端使用公开客户端认证。

开发者资料 API 已提供；完整服务端渲染门户和联系邮箱验证尚未完成。跨实例缓存与撤销、Redis 集成、真实数据库端到端验证、Web/native 接入示例、容器与运维交付仍待完成。API 路由见 [docs/api.md](docs/api.md)，实施限制见 [docs/progress.md](docs/progress.md)。

## 检查

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
```

GitHub Actions 在每次分支更新时自动运行上述检查。

## 运行准备

1. 复制 config.example.json 到受保护的配置路径，并填入账号只读库、OIDC 数据库、Redis URL、管理员摘要及现有账号系统的 HMAC 密钥。
2. 使用 npm run keys -- --out <受保护路径> 生成密钥材料；把其中的 cookie、fingerprint、subject、encryption 值填入配置。
3. 设置 OIDC_CONFIG_FILE 和 OIDC_SIGNING_KEY_FILE，分别指向受保护配置和密钥文件。
4. 在隔离的 OIDC 数据库执行 sql/postgre.sql。
5. 执行 npm run build && npm start。

不要提交实际密钥、管理员凭据、数据库连接串或 .env 文件。服务依赖真实数据库和现有账号库配置；当前分支未完成生产部署验证。