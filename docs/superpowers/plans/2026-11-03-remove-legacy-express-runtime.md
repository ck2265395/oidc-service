# Remove Legacy Express Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the rollback-only Express runtime and all production/test code reachable only through it, without changing the active NestJS or OIDC behavior.

**Architecture:** Keep NestJS as the sole composition root. Preserve the native Express routers that Nest still mounts for OIDC interactions and the user portal, but replace the oversized administrator router with a focused login router and move shared administrator-session validation into the Nest administrator service.

**Tech Stack:** Node.js 24, TypeScript 6, NestJS 12, Express 5 adapter, oidc-provider 9, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-remove-legacy-express-runtime-design.md`

## Global Constraints

- Delete only code proven unreachable from the Nest composition root.
- Do not rewrite `src/interactions.ts` or `src/user-portal.ts`.
- Do not change route contracts, cookies, OIDC claims, SQL, or protected configuration.
- Add no dependencies.
- Preserve unrelated local modifications in `runtime/config.example.json`, `src/developer-store.ts`, `src/interactions.ts`, and `test/developer-store.test.ts`.

## Review Focus

- Anonymous `/admin/*` requests must still redirect to `/admin/login`, while the login page remains public.
- Administrator login must retain origin, CSRF, rate-limit, session-cookie, and password verification behavior after extracting the router.
- Secure developer cookies must remain covered after removing the legacy cookie test.
- Native OIDC discovery, authorization, token, user-info, revocation, logout, interactions, and portal routes must remain unchanged.
- No deleted module or `start:legacy` reference may remain in production scripts or current documentation.

---

### Task 1: Freeze Cleanup Contracts

**Files:**
- Modify: `test/default-runtime.test.ts`
- Modify: `test/nest-admin-page.test.ts`
- Modify: `test/nest-developer-api.test.ts`

**Interfaces:**
- Consumes: current Nest package scripts and HTTP contracts.
- Produces: regression tests that fail until rollback artifacts are removed and preserve active login/cookie behavior.

- [ ] **Step 1: Write failing assertions**

Assert that `package.json` has no `start:legacy`, `src/legacy-main.ts` is absent, anonymous administrator routes redirect, administrator login remains available, and HTTPS developer sessions set `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and seven-day `Max-Age` attributes.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run test/default-runtime.test.ts test/nest-admin-page.test.ts test/nest-developer-api.test.ts`

Expected: FAIL because `start:legacy` and `legacy-main.ts` still exist; existing Nest behavior assertions remain green.

- [ ] **Step 3: Commit the contract tests with the implementation task that turns them green**

Do not commit a deliberately failing tree; stage these tests in Tasks 2-3 with their corresponding production changes.

---

### Task 2: Extract the Active Administrator Login Boundary

**Files:**
- Create: `src/modules/admin/admin-login.router.ts`
- Modify: `src/modules/admin/admin.module.ts`
- Modify: `src/modules/admin/admin.service.ts`
- Modify: `src/modules/admin/admin-page.controller.ts`
- Modify: `test/admin-origin.test.ts`
- Delete: `src/admin.ts`

**Interfaces:**
- Consumes: `ServiceConfig`, PostgreSQL `Pool`, existing security helpers, `AdminService.auth.authenticated()`.
- Produces: `createAdminLoginRouter(pool: Pool, config: ServiceConfig): Router`; self-contained `PostgresAdminAuth.authenticated(request: Request): Promise<boolean>`.

- [ ] **Step 1: Update administrator login tests to target the focused router**

Rename imports and constructor calls in `test/admin-origin.test.ts`; retain same-origin/null-origin coverage and add successful login cookie/redirect coverage if it is not already asserted elsewhere.

- [ ] **Step 2: Run administrator tests and verify RED**

Run: `npm test -- --run test/admin-origin.test.ts test/nest-admin-page.test.ts`

Expected: FAIL because `createAdminLoginRouter` does not exist.

- [ ] **Step 3: Implement the login-only router**

Move only GET/POST `/login`, origin/CSRF enforcement, login throttling, password verification, and administrator-session creation from `src/admin.ts` into `src/modules/admin/admin-login.router.ts`. Do not carry legacy HTML application/group/audit pages or logout routes.

- [ ] **Step 4: Remove the session API dependency**

Implement administrator cookie hashing and sliding-session validation directly in `PostgresAdminAuth.authenticated()`. Update `AdminModule.registerProduction()` to construct the focused login router with only pool and config.

- [ ] **Step 5: Delete `src/admin.ts` and run focused tests**

Run: `npm test -- --run test/admin-origin.test.ts test/nest-admin-page.test.ts test/nest-application-admin-api.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin test/admin-origin.test.ts test/nest-admin-page.test.ts
git rm src/admin.ts
git commit -m "refactor: isolate administrator login in Nest runtime"
```

---

### Task 3: Delete the Unreachable Express Runtime

**Files:**
- Modify: `package.json`
- Modify: `test/default-runtime.test.ts`
- Modify: `test/nest-developer-api.test.ts`
- Modify: `test/fixtures/service-config.ts`
- Delete: `src/legacy-main.ts`
- Delete: `src/app.ts`
- Delete: `src/account-api.ts`
- Delete: `src/admin-api.ts`
- Delete: `src/developer-auth.ts`
- Delete: `src/developer.ts`
- Delete: `src/session-api.ts`
- Delete: `src/user-api.ts`
- Delete: `test/account-api.test.ts`
- Delete: `test/admin-api.test.ts`
- Delete: `test/admin-developers.test.ts`
- Delete: `test/app.test.ts`
- Delete: `test/compatibility-cookie.test.ts`
- Delete: `test/compatibility-oidc.test.ts`
- Delete: `test/compatibility-route.test.ts`
- Delete: `test/developer-auth-api.test.ts`
- Delete: `test/developer-moondrop-login.test.ts`
- Delete: `test/session-api.test.ts`

**Interfaces:**
- Consumes: Nest contract coverage from Task 1 and existing domain tests.
- Produces: one runtime (`src/main.ts`) and a configuration-only `testServiceConfig()` fixture.

- [ ] **Step 1: Remove the rollback script and source files**

Delete `start:legacy` from `package.json`, remove all listed production files, and retain no compatibility aliases.

- [ ] **Step 2: Remove legacy-only tests and simplify fixtures**

Delete tests whose subject is the removed Express runtime. Remove `createTestService`, marker routers, and obsolete Express/HTTP imports from `test/fixtures/service-config.ts`; retain `testServiceConfig()` for Nest/domain tests.

- [ ] **Step 3: Verify import closure**

Run: `rg -n "legacy-main|start:legacy|createApplication|createAccountApiRouter|createAdminApiRouter|createDeveloperAuthRouter|createDeveloperRouter|createSessionApiRouter|createUserApiRouter" src test scripts package.json`

Expected: no production/test reference except deliberate historical migration documents, which are checked separately in Task 4.

- [ ] **Step 4: Run TypeScript, lint, and server tests**

Run: `npm run check && npm run lint && npm test`

Expected: PASS, including cleanup contracts from Task 1.

- [ ] **Step 5: Commit**

```bash
git add package.json test/default-runtime.test.ts test/nest-developer-api.test.ts test/fixtures/service-config.ts
git rm <all listed obsolete production and test files>
git commit -m "refactor: remove legacy Express runtime"
```

---

### Task 4: Update Current Documentation and Verify the Sole Runtime

**Files:**
- Modify: `README.md`
- Modify: `docs/nestjs-architecture.md`
- Modify: `docs/deploy.md`
- Modify if needed: `docs/http-route-inventory.md`

**Interfaces:**
- Consumes: sole-runtime state from Task 3.
- Produces: current documentation with no rollback command or temporary-entry guidance.

- [ ] **Step 1: Remove obsolete rollback guidance**

Describe NestJS as the only runtime. Remove `start:legacy`, one-release observation-window, and legacy-image coexistence instructions while retaining deployment rollback by previous image/tag where generally applicable.

- [ ] **Step 2: Search current sources and documentation**

Run: `rg -n "legacy-main|start:legacy|temporary one-release|rollback-only" README.md docs src test scripts package.json --glob '!docs/superpowers/**'`

Expected: no matches.

- [ ] **Step 3: Run full verification**

Run sequentially:

```bash
npm run check
npm run lint
npm test
npm run test:web
npm run build
npm run test:storage
git diff --check
```

Expected: typecheck, lint, server tests, 20 web tests, and build pass; storage test either passes with configured dependencies or reports only its existing environment-gated skip.

- [ ] **Step 4: Run read-only runtime smoke checks**

Verify `/health/ready` and discovery return 200, `/admin/login` returns 200, anonymous `/admin/overview` returns 303 to `/admin/login`, and a valid authorization request redirects to `/interaction/:uid`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/nestjs-architecture.md docs/deploy.md docs/http-route-inventory.md
git commit -m "docs: retire legacy runtime guidance"
```

## Completion Criteria

- NestJS is the only executable server composition.
- No dead legacy HTTP router remains in `src/`.
- Active native OIDC routers are retained because they remain reachable from `OidcProviderService`.
- Every current contract test and build gate passes.
- Only the user's pre-existing unrelated working-tree changes remain uncommitted.
