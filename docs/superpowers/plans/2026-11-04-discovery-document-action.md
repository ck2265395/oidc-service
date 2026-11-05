# Discovery Document Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Discovery 技术入口从文档首屏下沉到协议章节，并提供控制台入口与复制地址操作。

**Architecture:** 仅修改 `DeveloperDocs` 展示和对应组件测试，继续使用标准 `/.well-known/openid-configuration` 端点。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library

**Spec:** `docs/superpowers/specs/2026-11-04-discovery-document-action-design.md`

## Global Constraints

- 不新增依赖，不修改后端 Discovery 端点。
- 保留匿名开发者注册入口和原始 JSON 查看能力。

## Review Focus

- 首屏不再把 JSON 端点作为主要操作。
- 协议章节同时提供复制和原始 JSON 操作。
- 剪贴板不可用时页面仍可继续使用。

---

### Task 1: 调整 Discovery 操作层级

**Files:**
- Modify: `web/src/app/DeveloperDocs.tsx`
- Test: `web/src/app/DeveloperDocs.test.tsx`

- [ ] 添加失败测试，验证首屏控制台入口及协议章节中的 Discovery 操作。
- [ ] 运行单测确认因旧首屏布局失败。
- [ ] 实现复制地址反馈并移动原始 JSON 链接。
- [ ] 运行前端全量测试、类型检查和构建。
- [ ] 提交 `fix: clarify discovery document actions`。
