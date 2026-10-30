# DT Identity Service

独立开发的 OIDC 身份服务项目，使用 **DT／东土** 作为项目署名。当前分支正在搭建可验证的服务基础；OIDC 协议流程和业务门户尚未完成，不可用于生产环境。

## 技术基线

- Node.js 24 LTS、TypeScript、Express
- OIDC 协议由上游 `oidc-provider` 处理
- PostgreSQL 与 Redis 用于后续的持久化和跨实例状态
- 业务账号存储配置为只读连接

## 当前状态

现有代码仅包含严格配置校验、HTTP 健康检查和基础 CI 脚手架。后续功能按阶段加入；每个阶段以测试和验收记录为准。完整需求材料保存在项目维护方处，仓库只添加经过确认可公开的实现与说明。

## 开发

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
```

配置模板位于 [config.example.json](config.example.json)。不要将实际密钥、管理员凭据、数据库连接串或 `.env` 文件提交到 Git。

## 运行状态

`GET /health/live` 用于存活探测。当前服务没有开放 OIDC 登录或令牌端点。
