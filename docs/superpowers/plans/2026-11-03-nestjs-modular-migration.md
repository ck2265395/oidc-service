# NestJS Modular Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the OIDC platform backend from a flat Express composition to a NestJS 12 modular monolith while preserving every existing HTTP, storage, security, and OIDC protocol contract.

**Architecture:** A new Nest bootstrap is developed beside the legacy entry point until parity is proven. Nest controllers and providers own business routes and lifecycle; `oidc-provider` remains a native protocol handler mounted through the Nest Express adapter with scoped body parsing. Existing domain, SQL repository, Redis, and protocol implementation code is moved and wrapped before it is refactored.

**Tech Stack:** Node.js 24, TypeScript 6 ESM/NodeNext, NestJS 12.3.0, `@nestjs/platform-express`, Express 5, `oidc-provider` 9.13.3, PostgreSQL/`pg`, Redis, Nodemailer, Node test runner, React/Vite/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-nestjs-modular-migration-design.md`

## Global Constraints

- Use NestJS 12 with Node.js 24 and keep all `@nestjs/*` packages on the same pinned version.
- Keep ESM, `type: module`, `NodeNext`, strict TypeScript, the current npm workspace, and the Express adapter.
- Preserve URLs, methods, status codes, response bodies, redirects, cookie names/attributes, Redis keys, issuer metadata, signing keys, database schemas, and existing data.
- Do not modify applied migrations `001`–`003`; the framework migration itself adds no schema migration.
- Do not wrap or rewrite native OIDC discovery, authorization, token, user-info, revocation, or logout responses.
- Do not globally parse request bodies before `oidc-provider`.
- Never log bodies, query strings, headers, cookies, credentials, email codes, authorization values, tokens, secrets, database URLs, or SMTP configuration.
- Keep the account database read-only and keep protected configuration/signing files outside version control.
- Keep the React/Vite workspace and same-origin deployment behavior unchanged.
- Add dependencies explicitly in Task 2 only; do not upgrade unrelated packages.

## Review Focus

- A form POST to `/token` must reach `oidc-provider` with an unread body and complete Authorization Code + PKCE exchange; Task 9 adds the contract test.
- Requests containing passwords, email codes, query tokens, cookies, or Authorization headers must produce logs without those values; Task 3 adds redaction tests.
- Reverse-proxy HTTPS requests from trusted versus untrusted CIDRs must retain the current issuer, secure-cookie, and client-IP behavior; Task 3 adds proxy tests.
- Duplicate email registration and optimistic review conflicts must retain distinct business error/status mappings rather than become generic 500 responses; Tasks 7 and 8 add controller tests.
- SIGTERM during in-flight traffic must stop accepting requests and close HTTP, both PostgreSQL pools, both Redis clients, and Nodemailer once; Task 4 adds lifecycle tests.

---

## Planned file structure

```text
src/
├─ main.ts                              # final Nest entry point after cutover
├─ nest-main.ts                         # temporary parallel Nest entry point
├─ legacy-main.ts                       # temporary rollback entry after cutover
├─ app.module.ts
├─ bootstrap/bootstrap.ts
├─ common/
│  ├─ errors/application.error.ts
│  ├─ filters/application-exception.filter.ts
│  ├─ logging/request-logger.middleware.ts
│  ├─ middleware/request-context.middleware.ts
│  └─ tokens/injection-tokens.ts
├─ infrastructure/
│  ├─ config/config.module.ts
│  ├─ config/config.service.ts
│  ├─ database/database.module.ts
│  ├─ redis/redis.module.ts
│  ├─ email/email.module.ts
│  └─ web/web.module.ts
└─ modules/
   ├─ health/
   ├─ account/
   ├─ developer-auth/
   ├─ developer/
   ├─ application/
   ├─ admin/
   └─ oidc/
```

Existing files remain importable until the task that moves their responsibility. Moves must use `git mv`; each task updates imports and tests in the same commit.

### Task 1: Freeze legacy HTTP and protocol contracts

**Files:**
- Create: `test/compatibility-route.test.ts`
- Create: `test/compatibility-oidc.test.ts`
- Create: `test/compatibility-cookie.test.ts`
- Create: `test/fixtures/service-config.ts`
- Create: `docs/http-route-inventory.md`
- Modify: `test/app.test.ts`

**Interfaces:**
- Consumes: existing `createApplication`, `createProvider`, router factories, and test doubles.
- Produces: `createTestService(options): { baseUrl: string; close(): Promise<void> }` in `test/fixtures/service-config.ts`, plus the compatibility suite every later task must pass.

- [ ] **Step 1: Write failing route-inventory assertions**

Add tests named `legacy runtime exposes the frozen business route inventory`, `legacy runtime preserves redirect and SPA fallback precedence`, and `legacy runtime preserves cookie names and attributes`. Assert all current `/health`, `/api/v1`, `/interaction`, `/portal`, `/developer`, `/account`, `/admin`, `/assets`, and `/app` method/path owners; assert representative status/body/redirect/cookie contracts.

- [ ] **Step 2: Run the compatibility tests and verify the inventory gaps fail**

Run: `npm test -- --test-name-pattern="legacy runtime"`

Expected: FAIL because the fixture and complete inventory do not exist.

- [ ] **Step 3: Implement the reusable service fixture and route inventory**

Keep the fixture dependency-injected and network-local. Document protocol-owned versus business-owned paths in `docs/http-route-inventory.md`; do not derive expected values from the runtime under test.

- [ ] **Step 4: Add OIDC characterization assertions**

Assert discovery endpoint names, issuer, supported PKCE method, enabled grant/response types, JWKS route, authorization redirect into `/interaction/:uid`, and provider-native content types/cache headers.

- [ ] **Step 5: Run the focused and full suites**

Run: `npm test -- --test-name-pattern="legacy runtime|OIDC contract" && npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add test/compatibility-route.test.ts test/compatibility-oidc.test.ts test/compatibility-cookie.test.ts test/fixtures test/app.test.ts docs/http-route-inventory.md
git commit -m "test: freeze identity HTTP contracts"
```

### Task 2: Add the parallel NestJS foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `src/nest-main.ts`
- Create: `src/app.module.ts`
- Create: `src/bootstrap/bootstrap.ts`
- Create: `src/infrastructure/config/config.module.ts`
- Create: `src/infrastructure/config/config.service.ts`
- Create: `test/nest-bootstrap.test.ts`

**Interfaces:**
- Consumes: `loadConfig(input: unknown): ServiceConfig` and protected config/signing environment variables.
- Produces: `bootstrapNest(options?: BootstrapOptions): Promise<NestApplicationHandle>`, `ConfigService.get(): ServiceConfig`, and a temporary `dev:nest`/`start:nest` command without changing default `dev`/`start`.

- [ ] **Step 1: Write the failing Nest bootstrap test**

Test `parallel Nest runtime loads the protected config and starts without replacing the legacy entry point`. Assert `ConfigService` exposes one immutable config object, fails closed when paths are missing/invalid, and `package.json` still points default scripts at the legacy runtime.

- [ ] **Step 2: Run the test and verify it fails because Nest artifacts are absent**

Run: `npm test -- --test-name-pattern="parallel Nest runtime"`

Expected: FAIL with missing module/import errors.

- [ ] **Step 3: Add only the required pinned dependencies**

Pin `@nestjs/common`, `@nestjs/core`, and `@nestjs/platform-express` to `12.3.0`; add exact compatible releases of `reflect-metadata` and `rxjs` recorded in the lockfile. Preserve Express 5 and all unrelated dependency versions. Enable decorators and metadata in `tsconfig.json` only as required by Nest.

- [ ] **Step 4: Implement the minimal Nest application and config provider**

Define `BootstrapOptions` with injectable config/signing paths and an optional port for tests. Start Nest with `bodyParser: false`, `bufferLogs: true`, and the Express adapter. Do not mount business or provider routes yet.

- [ ] **Step 5: Add parallel scripts and verify builds**

Add `dev:nest` and `start:nest`; keep `dev` and `start` unchanged. Run `npm run check && npm test -- --test-name-pattern="parallel Nest runtime" && npm run build:server`.

Expected: PASS and `dist/src/nest-main.js` exists.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/nest-main.ts src/app.module.ts src/bootstrap src/infrastructure/config test/nest-bootstrap.test.ts
git commit -m "feat: establish parallel Nest runtime"
```

### Task 3: Add request context, safe logging, security headers, and proxy behavior

**Files:**
- Create: `src/common/middleware/request-context.middleware.ts`
- Create: `src/common/logging/request-logger.middleware.ts`
- Create: `src/common/logging/log-record.ts`
- Create: `src/common/filters/application-exception.filter.ts`
- Create: `src/common/errors/application.error.ts`
- Create: `src/common/tokens/injection-tokens.ts`
- Create: `test/request-observability.test.ts`
- Modify: `src/app.module.ts`
- Modify: `src/bootstrap/bootstrap.ts`

**Interfaces:**
- Consumes: `ConfigService.get()` and Nest `LoggerService`.
- Produces: `REQUEST_ID`, `REQUEST_LOGGER`, `ApplicationError`, `ApplicationExceptionFilter`, and one completion log per response.

- [ ] **Step 1: Write failing logging and security tests**

Test names: `logs one bounded completion event without sensitive request data`, `normalizes protocol paths without query strings`, `preserves supplied request IDs only when syntactically safe`, and `trusts forwarded protocol and IP only from configured proxies`. Include passwords, codes, bearer/basic authorization, cookies, client secrets, and query tokens as canaries and assert none occur in serialized logs.

- [ ] **Step 2: Run the tests and verify they fail due to missing middleware**

Run: `npm test -- --test-name-pattern="completion event|protocol paths|request IDs|configured proxies"`

Expected: FAIL.

- [ ] **Step 3: Implement request context and logging**

Expose `requestId` through response locals/request context, log `{ event, requestId, method, path, status, durationMs, routeKind }` on `finish`, log pathname only, classify provider routes as `protocol`, and omit configured health noise in production.

- [ ] **Step 4: Implement security headers and trusted proxy setup**

Preserve the exact current CSP, HSTS condition, no-store, nosniff, frame, and referrer behavior before all routes and static files.

- [ ] **Step 5: Implement the business exception filter**

Map typed application errors to the existing business response shape and include a request ID for unknown errors without exposing internal details. Do not register it around native provider middleware.

- [ ] **Step 6: Verify focused and full suites**

Run: `npm test -- --test-name-pattern="completion event|protocol paths|request IDs|configured proxies" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/common src/app.module.ts src/bootstrap/bootstrap.ts test/request-observability.test.ts
git commit -m "feat: add safe HTTP observability"
```

### Task 4: Migrate infrastructure ownership and shutdown lifecycle

**Files:**
- Create: `src/infrastructure/database/database.module.ts`
- Create: `src/infrastructure/redis/redis.module.ts`
- Create: `src/infrastructure/email/email.module.ts`
- Create: `src/infrastructure/keys/signing-key.service.ts`
- Create: `test/infrastructure-lifecycle.test.ts`
- Modify: `src/app.module.ts`
- Modify: `src/bootstrap/bootstrap.ts`
- Modify: `src/nest-main.ts`

**Interfaces:**
- Produces injection tokens `OIDC_POOL`, `ACCOUNT_POOL`, `REDIS_COMMAND`, `REDIS_SUBSCRIBER`, `MAILER`, and `OIDC_SIGNING_KEYS`; every owner implements `OnApplicationShutdown` idempotently.
- Consumes: existing pool/client/mailer/key constructors without changing storage formats.

- [ ] **Step 1: Write failing ownership and shutdown tests**

Test `infrastructure providers create each client once`, `readiness dependencies are distinct`, and `SIGTERM shutdown drains HTTP and closes every resource exactly once even after partial startup failure`.

- [ ] **Step 2: Run and verify the lifecycle tests fail**

Run: `npm test -- --test-name-pattern="infrastructure providers|SIGTERM shutdown|partial startup"`

Expected: FAIL.

- [ ] **Step 3: Implement factory providers and explicit tokens**

Keep the OIDC pool and account pool distinct. Create Redis command/subscriber clients from the same protected configuration. Create `MAILER` as nullable without treating absent SMTP as startup failure.

- [ ] **Step 4: Implement idempotent initialization and shutdown**

Connect resources during module initialization, close them through Nest shutdown hooks, and preserve current partial-startup cleanup behavior.

- [ ] **Step 5: Verify lifecycle, readiness dependencies, and full tests**

Run: `npm test -- --test-name-pattern="infrastructure providers|SIGTERM shutdown|partial startup" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure src/app.module.ts src/bootstrap src/nest-main.ts test/infrastructure-lifecycle.test.ts
git commit -m "feat: manage identity infrastructure with Nest"
```

### Task 5: Migrate health, static assets, and SPA fallbacks

**Files:**
- Create: `src/modules/health/health.module.ts`
- Create: `src/modules/health/health.controller.ts`
- Create: `src/modules/health/health.service.ts`
- Create: `src/infrastructure/web/web.module.ts`
- Create: `src/infrastructure/web/web.controller.ts`
- Create: `test/nest-web-contract.test.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces current `/health/live`, `/health/ready`, `/assets/*`, `/app/*`, `/`, and SPA fallback behavior.
- Consumes infrastructure health probes and `public/app/index.html`.

- [ ] **Step 1: Write failing Nest web contract tests**

Assert liveness, readiness success/failure, immutable asset cache policy, missing asset 404 behavior, root shell, developer/account/admin SPA fallbacks, admin-login exclusion, and path traversal rejection.

- [ ] **Step 2: Run and verify failures**

Run: `npm test -- --test-name-pattern="Nest web contract"`

Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement health controllers and probes**

Preserve `{ status, requestId }`, 200/503 behavior, and checks for both pools plus both Redis clients where applicable.

- [ ] **Step 4: Implement static and SPA delivery**

Resolve files under `public` safely, preserve `/app` and `/assets` cache headers, and serve the console shell only for current SPA routes.

- [ ] **Step 5: Run compatibility and security tests**

Run: `npm test -- --test-name-pattern="Nest web contract|legacy runtime" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/health src/infrastructure/web src/app.module.ts test/nest-web-contract.test.ts
git commit -m "feat: migrate health and web hosting to Nest"
```

### Task 6: Migrate account and session APIs

**Files:**
- Create: `src/modules/account/account.module.ts`
- Create: `src/modules/account/controllers/account.controller.ts`
- Create: `src/modules/account/controllers/me.controller.ts`
- Create: `src/modules/account/controllers/session.controller.ts`
- Create: `src/modules/account/application/account.service.ts`
- Create: `src/modules/account/infrastructure/account.repository.ts`
- Create: `test/nest-account-api.test.ts`
- Modify: `src/app.module.ts`
- Move/update: `src/accounts.ts`, `src/account-api.ts`, `src/user-api.ts`, `src/session-api.ts`

**Interfaces:**
- Produces the frozen `/api/v1/account`, `/api/v1/me`, and `/api/v1/session` contracts and an exported account-resolution port for `OidcModule`.
- Consumes `ACCOUNT_POOL`, `OIDC_POOL`, config subject/fingerprint secrets, and provider-session access through an explicit port.

- [ ] **Step 1: Write failing controller parity tests**

Assert authenticated/anonymous profile behavior, authorization ownership checks, session listing/revocation, CSRF/origin rejection, pagination bounds, and profile-picture base URL handling.

- [ ] **Step 2: Run and verify Nest route failures**

Run: `npm test -- --test-name-pattern="Nest account API"`

Expected: FAIL because controllers are absent.

- [ ] **Step 3: Register existing account domain/repository code as providers**

Move without behavioral refactoring first; expose narrow interfaces needed by controllers and later by OIDC account lookup.

- [ ] **Step 4: Implement controllers and boundary validation**

Preserve response/status/cookie/CSRF/origin behavior from Task 1. Do not introduce a new response envelope.

- [ ] **Step 5: Verify module and compatibility suites**

Run: `npm test -- --test-name-pattern="Nest account API|legacy runtime" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/account src/app.module.ts test/nest-account-api.test.ts src/accounts.ts src/account-api.ts src/user-api.ts src/session-api.ts
git commit -m "feat: migrate account APIs to Nest"
```

### Task 7: Migrate developer authentication and developer profile APIs

**Files:**
- Create: `src/modules/developer-auth/developer-auth.module.ts`
- Create: `src/modules/developer-auth/developer-auth.controller.ts`
- Create: `src/modules/developer-auth/developer-auth.service.ts`
- Create: `src/modules/developer-auth/dto/register-developer.dto.ts`
- Create: `src/modules/developer-auth/dto/login-developer.dto.ts`
- Create: `src/modules/developer-auth/dto/email-code.dto.ts`
- Create: `src/modules/developer/developer.module.ts`
- Create: `src/modules/developer/developer.controller.ts`
- Create: `src/modules/developer/developer.service.ts`
- Create: `src/modules/developer/infrastructure/developer.repository.ts`
- Create: `test/nest-developer-api.test.ts`
- Modify: `src/app.module.ts`
- Move/update: `src/developer-auth.ts`, `src/developer-auth-service.ts`, `src/developer-email-code.ts`, `src/developer-identity.ts`, `src/developer-session.ts`, `src/developer-store.ts`, relevant developer routes from `src/developer.ts`

**Interfaces:**
- Produces frozen developer-auth cookies/routes, developer profile/review/status APIs, and exported developer identity/session services.
- Consumes Redis, mailer, OIDC pool, account binding port, request-origin/CSRF utilities, and fingerprint secret.

- [ ] **Step 1: Write failing developer parity and conflict tests**

Assert email-code rate limits, invalid/expired code, password policy, duplicate normalized email returns the established conflict status/code, session cookie attributes, logout CSRF, disabled account behavior, profile completeness, submit/re-submit transitions, optimistic review conflicts, and MOONDROP binding without email-based account merging.

- [ ] **Step 2: Run and verify failures**

Run: `npm test -- --test-name-pattern="Nest developer API"`

Expected: FAIL because the Nest modules are absent.

- [ ] **Step 3: Move domain and repository code behind Nest providers**

Preserve Redis keys, password digest format, session hash/expiry, SQL, transaction boundaries, status values, and account-isolation rules.

- [ ] **Step 4: Implement DTO validation, controllers, guards, and error mappings**

Map PostgreSQL unique violation to the existing registration conflict response; map invalid codes, disabled accounts, state conflicts, and unavailable dependencies distinctly without logging inputs.

- [ ] **Step 5: Verify focused, compatibility, and full suites**

Run: `npm test -- --test-name-pattern="Nest developer API|developer auth|developer review" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/developer-auth src/modules/developer src/app.module.ts test/nest-developer-api.test.ts src/developer*.ts
git commit -m "feat: migrate developer identity APIs to Nest"
```

### Task 8: Migrate applications, groups, and administrator APIs

**Files:**
- Create: `src/modules/application/application.module.ts`
- Create: `src/modules/application/application.controller.ts`
- Create: `src/modules/application/application.service.ts`
- Create: `src/modules/application/infrastructure/application.repository.ts`
- Create: `src/modules/admin/admin.module.ts`
- Create: `src/modules/admin/admin.controller.ts`
- Create: `src/modules/admin/admin-auth.guard.ts`
- Create: `src/modules/admin/admin.service.ts`
- Create: `test/nest-application-admin-api.test.ts`
- Modify: `src/app.module.ts`
- Move/update: `src/applications.ts`, `src/groups.ts`, `src/platform.ts`, `src/store.ts`, `src/admin-api.ts`, business portions of `src/admin.ts`

**Interfaces:**
- Produces current developer application/group APIs, administrator authentication/review/audit/statistics APIs, application lookup for `OidcModule`, and Redis client-cache invalidation publication.
- Consumes OIDC pool, Redis publisher/subscriber, encryption secret, developer approval service, and admin configuration.

- [ ] **Step 1: Write failing application/admin parity tests**

Assert approved-developer gate, draft creation, group ownership, submit/review transitions, optimistic revision conflict status, duplicate names, secret one-time return/rotation, admin authentication/cookie/CSRF/origin behavior, audit pagination, and client-cache invalidation.

- [ ] **Step 2: Run and verify failures**

Run: `npm test -- --test-name-pattern="Nest application and admin API"`

Expected: FAIL.

- [ ] **Step 3: Move application/group domain and repository code into providers**

Preserve encryption format, SQL, revision rules, audit writes, client configuration projection, and cache-clear channel name.

- [ ] **Step 4: Implement developer and administrator controllers/guards**

Keep administrator routes unlinked from the public portal and preserve all current response/error contracts, including distinct optimistic conflicts.

- [ ] **Step 5: Verify focused and full suites**

Run: `npm test -- --test-name-pattern="Nest application and admin API|application|admin" && npm test && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/application src/modules/admin src/app.module.ts test/nest-application-admin-api.test.ts src/applications.ts src/groups.ts src/platform.ts src/store.ts src/admin-api.ts src/admin.ts
git commit -m "feat: migrate application administration to Nest"
```

### Task 9: Mount native `oidc-provider` and migrate interaction/portal routes

**Files:**
- Create: `src/modules/oidc/oidc.module.ts`
- Create: `src/modules/oidc/oidc-provider.service.ts`
- Create: `src/modules/oidc/oidc-protocol.middleware.ts`
- Create: `src/modules/oidc/interaction.controller.ts`
- Create: `src/modules/oidc/portal.controller.ts`
- Create: `src/modules/oidc/oidc-audit.service.ts`
- Create: `test/nest-oidc-contract.test.ts`
- Modify: `src/app.module.ts`
- Modify: `src/bootstrap/bootstrap.ts`
- Move/update: `src/provider.ts`, `src/adapter.ts`, `src/interactions.ts`, `src/user-portal.ts`

**Interfaces:**
- Produces the existing issuer discovery, JWKS, authorization, token, user-info, revocation, logout, interaction, and portal contracts.
- Consumes account resolution, application lookup, OIDC pool/Redis adapter dependencies, signing keys, cookie/encryption configuration, login limiter, and audit writer.

- [ ] **Step 1: Write failing native-provider contract tests**

Assert discovery/JWKS parity, Authorization Code + S256 PKCE end to end, unread form body reaches `/token`, user-info, revocation, logout, consent/login redirects, provider-native errors/content types/cache headers, and unknown business routes are not swallowed by provider middleware.

- [ ] **Step 2: Run and verify failures**

Run: `npm test -- --test-name-pattern="Nest OIDC contract"`

Expected: FAIL because the native provider is not mounted.

- [ ] **Step 3: Implement `OidcProviderService` and scoped protocol middleware**

Construct the provider from existing factories. Dispatch only provider-owned paths from the frozen inventory to `provider.callback()`; call `next()` for every Nest/static/business path. Scope JSON and URL-encoded parsers to Nest-owned routes.

- [ ] **Step 4: Migrate interaction, portal, login limiter, audit, and cache invalidation wiring**

Preserve server-rendered credential/consent handling, portal callback state, cookies, protocol audit action names, and Redis cache-clear channel semantics.

- [ ] **Step 5: Run protocol, compatibility, security, and full suites**

Run: `npm test -- --test-name-pattern="Nest OIDC contract|OIDC contract|completion event" && npm test && npm run check && npm run build:server`

Expected: PASS with no protocol response wrapping and no sensitive log canaries.

- [ ] **Step 6: Commit**

```bash
git add src/modules/oidc src/app.module.ts src/bootstrap test/nest-oidc-contract.test.ts src/provider.ts src/adapter.ts src/interactions.ts src/user-portal.ts
git commit -m "feat: integrate oidc-provider with Nest"
```

### Task 10: Cut over the runtime, remove obsolete composition, and update operations

**Files:**
- Modify: `src/main.ts`
- Move: `src/main.ts` legacy composition to `src/legacy-main.ts` before replacing it
- Remove after parity: `src/app.ts` and obsolete router/composition files proven unused by `rg` and TypeScript
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `README.md`
- Modify: `docs/console-architecture.md`
- Modify: `docs/deploy.md`
- Modify: `docs/api.md`
- Create: `docs/nestjs-architecture.md`
- Modify: `.github/workflows/ci.yml` only where entry points/check commands changed
- Modify: `.github/workflows/bootstrap-lock.yml` only if the locked bootstrap command changes

**Interfaces:**
- Consumes: complete Nest runtime from Tasks 2–9 and compatibility suite from Task 1.
- Produces: default `dev`, `start`, build, migration, container, and operations workflows using Nest; a tagged/branch rollback path to the previous image.

- [ ] **Step 1: Write failing default-entry and deployment assertions**

Add tests/checks that `npm run dev` and `npm start` target the Nest entry, production image contains the Nest build and React assets, protected config paths are unchanged, and no runtime import reaches obsolete Express composition.

- [ ] **Step 2: Run and verify the checks fail while legacy remains default**

Run: `npm test -- --test-name-pattern="default runtime"`

Expected: FAIL because scripts still select the legacy entry.

- [ ] **Step 3: Switch entry points and retain a temporary explicit rollback script**

Move the legacy start function to `legacy-main.ts`, make `main.ts` call `bootstrapNest`, set `dev`/`start` to Nest, and add `start:legacy` for one migration release only. Do not change migration or protected configuration selection semantics.

- [ ] **Step 4: Remove obsolete composition after static import verification**

Use `rg` plus TypeScript to prove each removed file is unused. Keep domain/repository files that remain provider dependencies; do not delete based only on filename.

- [ ] **Step 5: Update architecture, API, deployment, logging, cutover, and rollback documentation**

Document module ownership, safe log fields, PM2/cluster/container behavior, health checks, frontend build, migration commands, target-environment acceptance, and rollback to the previous application image.

- [ ] **Step 6: Run the complete acceptance gate**

Run:

```bash
npm run check
npm run lint
npm test
npm run test:web
npm run build
npm run test:storage
git diff --check
```

Expected: every command exits 0. Then run a local smoke flow: readiness, developer email registration/login, profile update/review submission, approved application authorization-code + PKCE login, token, user-info, revocation, logout, administrator review, and graceful SIGTERM. Confirm one safe completion log per request.

- [ ] **Step 7: Commit**

```bash
git add src package.json package-lock.json Dockerfile compose.yaml README.md docs .github test
git commit -m "refactor: cut identity service over to Nest"
```

## Self-review record

- Spec coverage: all goals, non-goals, protocol mounting, logging, security, static hosting, lifecycle, testing, deployment, and rollback requirements map to Tasks 1–10.
- Step scan: every task follows red/green verification and ends in an independently reviewable commit.
- Type consistency: config, infrastructure tokens, account/developer/application exports, and OIDC dependencies are introduced before consumption.
- Review focus: token body parsing, sensitive logging, trusted proxies, conflict mapping, and shutdown are each assigned explicit tests.
- Proportion: the plan specifies interfaces and observable assertions without transcribing implementation bodies.
