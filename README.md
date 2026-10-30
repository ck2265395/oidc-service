# DT Identity Service

独立开发的 OIDC 身份服务项目，项目署名使用 **DT／东土**。实现仍在开发中，不可用于生产环境。

## 技术基线

- Node.js 24、TypeScript、Express
- OIDC 协议由上游 oidc-provider 处理
- PostgreSQL 保存平台应用与 OIDC 协议状态
- 账号库通过只读连接查询；Redis 跨实例集成尚未完成

## 当前实现

仓库包含严格配置校验、受保护密钥工具、只读账号认证、应用配置校验、审核状态与 PostgreSQL 存储，以及上游 OIDC Provider 配置和 CSRF 保护的登录/授权同意页面。

仍未完成开发者门户、管理员后台、应用组与客户端密钥生命周期。Web 保密客户端目前不会被协议适配器加载。真实数据库权限、Redis、多实例、容器、Web/native 接入示例和完整端到端验收也未完成。详细产品需求材料不存放在本公共仓库。

## 检查

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
```

CI 在每次分支更新时自动运行上述检查。

## 运行准备

1. 复制 config.example.json 到受保护的配置路径，并填入账号只读库、OIDC 数据库、Redis URL、管理员摘要及现有账号系统的 HMAC 密钥。
2. 使用 npm run keys -- --out <受保护路径> 生成密钥材料；把其中的 cookie、fingerprint、subject、encryption 值填入配置。
3. 设置 OIDC_CONFIG_FILE 和 OIDC_SIGNING_KEY_FILE，分别指向受保护配置和密钥文件。
4. 在隔离的 OIDC 数据库执行 sql/postgre.sql。
5. 执行 npm run build && npm start。

不要提交实际密钥、管理员凭据、数据库连接串或 .env 文件。服务依赖真实数据库和现有账号库配置；本仓库当前未完成生产部署验证。