# Unified Identity Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one production-quality UI system for the public identity portal, OIDC interactions, account center, developer console, and administration console.

**Architecture:** Add a React/Vite frontend in `web/`, compiled into `public/app/` and served same-origin by Express. Convert server-rendered management surfaces into authenticated JSON APIs while retaining oidc-provider and server-side security boundaries.

**Tech Stack:** Node.js 24, TypeScript 6, Express 5, React 19, React Router, Vite, Vitest, Testing Library, Playwright, PostgreSQL, Redis.

**Spec:** `docs/superpowers/specs/2026-11-02-unified-identity-console-design.md`

## Global Constraints

- Do not modify `moondrop-service` or `moondrop-admin`.
- Keep OIDC issuer and protocol endpoints stable.
- Keep same-origin HttpOnly cookie sessions and require CSRF on mutations.
- Keep secrets and runtime configuration server-only.
- Use TDD for backend contracts and frontend behavior.
- Preserve accessible keyboard operation and responsive layouts.

## Review Focus

- Expired user/admin sessions must redirect or return `401` without leaking data; covered in Task 2.
- Missing, stale, or mismatched CSRF tokens must return `403`; covered in Task 2.
- Direct navigation to SPA routes must serve the shell without shadowing `/api` or OIDC routes; covered in Task 1.
- Empty/error/loading states must remain usable on narrow screens; covered in Tasks 3–6.
- One-time client secrets must not reappear after dialog dismissal or refresh; covered in Task 5.

---

### Task 1: Frontend foundation and deploy boundary

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/**`
- Modify: `package.json`, `src/app.ts`, `Dockerfile`, `.gitignore`
- Test: `test/app.test.ts`, `web/src/app/App.test.tsx`

**Interfaces:**
- Produces `ConsoleApp`, shared design tokens/components, and Express SPA fallback under non-API UI routes.
- Produces root scripts `web:dev`, `web:test`, and `build:web`; root `build` compiles backend and frontend.

- [ ] Write failing backend tests for SPA fallback and API/OIDC route exclusion.
- [ ] Write failing frontend test for public shell navigation.
- [ ] Add React/Vite dependencies and frontend scaffold.
- [ ] Implement design tokens, responsive shell, route map, and static build integration.
- [ ] Run backend/frontend tests, type checks and production build.

### Task 2: Session bootstrap and security API contracts

**Files:**
- Create: `src/session-api.ts`, `src/http-security.ts`, `test/session-api.test.ts`
- Modify: `src/app.ts`, `src/main.ts`, `src/admin.ts`, `src/user-portal.ts`
- Test: `test/session-api.test.ts`, `test/admin-origin.test.ts`

**Interfaces:**
- Produces `GET /api/v1/session`, `POST /api/v1/session/logout`, `GET /api/v1/session/csrf`.
- Produces reusable same-origin/CSRF middleware consumed by Tasks 3–6.

- [ ] Write failing tests for anonymous, account and admin bootstrap responses.
- [ ] Write failing tests for expired session and invalid CSRF mutations.
- [ ] Implement typed session bootstrap and shared mutation guard.
- [ ] Replace duplicated form-origin checks with the shared guard without changing OIDC behavior.
- [ ] Run security API tests and the full backend suite.

### Task 3: Public portal and OIDC interaction experience

**Files:**
- Create: `web/src/features/public/**`, `web/src/features/auth/**`
- Modify: `src/interactions.ts`, `src/app.ts`
- Test: `test/interactions.test.ts`, `web/src/features/auth/*.test.tsx`

**Interfaces:**
- Produces public home, sign-in, consent, error and service-status pages.
- Consumes Task 1 shell/components and existing interaction POST contracts.

- [ ] Write failing tests for login context, consent scopes, denial and safe return paths.
- [ ] Add JSON/bootstrap representation for interaction pages while preserving form fallback.
- [ ] Implement branded login, consent and protocol error screens.
- [ ] Verify keyboard, loading, error and narrow-screen states.
- [ ] Run interaction and frontend tests.

### Task 4: Account center

**Files:**
- Create: `src/account-portal-api.ts`, `web/src/features/account/**`
- Modify: `src/main.ts`, `src/app.ts`, `src/user-portal.ts`
- Test: `test/account-portal-api.test.ts`, `web/src/features/account/*.test.tsx`

**Interfaces:**
- Produces profile and authorization list/revoke JSON APIs.
- Produces `/account/profile` and `/account/authorizations` routes.

- [ ] Write failing authorization ownership and revoke-CSRF tests.
- [ ] Implement account portal JSON API over existing session/account services.
- [ ] Implement profile, authorization list, revoke confirmation and empty/error states.
- [ ] Keep legacy portal redirects for compatibility.
- [ ] Run account API/frontend tests and full backend suite.

### Task 5: Developer console

**Files:**
- Create: `web/src/features/developer/**`
- Modify: `src/developer.ts`, `public/developer.*`, `src/app.ts`
- Test: `test/developer.test.ts`, `web/src/features/developer/*.test.tsx`

**Interfaces:**
- Consumes existing developer APIs and Task 2 session bootstrap.
- Produces overview, profile, applications, application editor/detail, groups and docs routes.

- [ ] Write failing frontend tests for unauthenticated redirect and status-based actions.
- [ ] Add missing overview metrics and normalized API error fields.
- [ ] Implement dashboard navigation and all existing developer workflows.
- [ ] Implement one-time secret dialog with non-persistent state and confirmation flows.
- [ ] Remove legacy developer static entry after compatibility redirect tests pass.
- [ ] Run developer frontend/backend tests.

### Task 6: Administration console

**Files:**
- Create: `src/admin-api.ts`, `web/src/features/admin/**`
- Modify: `src/admin.ts`, `src/main.ts`, `src/app.ts`
- Test: `test/admin-api.test.ts`, `web/src/features/admin/*.test.tsx`

**Interfaces:**
- Produces admin login/session, overview, applications, groups, audit and statistics JSON APIs.
- Produces `/admin/*` SPA routes while preserving isolated admin session cookies.

- [ ] Write failing tests for admin login, session isolation, pagination, filtering and review commands.
- [ ] Implement admin JSON API using existing queries/services and shared mutation guard.
- [ ] Implement login, dashboard, review queues/details, audit filters and statistics views.
- [ ] Add confirmation/error/success states and responsive tables.
- [ ] Retire server-rendered admin pages after API and route compatibility tests pass.
- [ ] Run admin API/frontend tests and the full suite.

### Task 7: End-to-end, deployment and documentation

**Files:**
- Create: `web/e2e/**`, `playwright.config.ts`
- Modify: `README.md`, `docs/deploy.md`, `Dockerfile`, `compose.yaml`, `package.json`
- Test: `web/e2e/*.spec.ts`

**Interfaces:**
- Produces reproducible build/deploy commands and end-to-end acceptance coverage.

- [ ] Add failing E2E smoke tests for public, account, developer and admin route shells.
- [ ] Add authenticated fixture coverage for application submit/review and authorization revoke.
- [ ] Update Docker multi-stage build and deployment documentation.
- [ ] Run `npm run check`, `npm run lint`, `npm test`, frontend tests, E2E tests and `npm run build`.
- [ ] Inspect desktop and narrow-screen screenshots and correct material layout defects.

