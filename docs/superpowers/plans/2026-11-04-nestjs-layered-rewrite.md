# NestJS Layered Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining flat `src/*.ts` implementation with a complete NestJS layered modular monolith and delete the flat files without changing external behavior.

**Architecture:** Perform one coordinated cutover rather than maintaining compatibility wrappers. Split symbols by ownership into domain, application, infrastructure, and HTTP/protocol adapter layers; compose them through an explicit acyclic Nest module graph. Keep `oidc-provider` on the Express adapter as protocol infrastructure.

**Tech Stack:** Node.js 24, TypeScript 6, NestJS 12, Express 5 adapter, oidc-provider 9, PostgreSQL, Redis, Node test runner, React/Vite console.

**Spec:** `docs/superpowers/specs/2026-11-04-nestjs-layered-rewrite-design.md`

## Global Constraints

- Do not add dependencies, change API contracts, alter database/Redis schemas, or change protected configuration formats.
- Preserve cookie, CSRF, origin, password, code, token, logging, OIDC middleware, and response semantics.
- Restrict Express types to HTTP/protocol boundaries.
- Leave only `app.module.ts`, `main.ts`, and directories at `src/` root.
- Preserve `runtime/config.example.json` as an unrelated unstaged user change.
- Preserve and migrate the existing local changes in `src/developer-store.ts`, `src/interactions.ts`, and `test/developer-store.test.ts` into their final owned paths.
- Low-token verification policy selected by the user: do not run the test suite after each task. Use reference scans during migration, then run TypeScript, ESLint, all tests, and production build once after the complete cutover. Run a targeted test earlier only to diagnose an actual failure.

## Review Focus

- Nest production provider graph must resolve without accidental global-provider visibility or circular imports.
- OIDC middleware ordering must leave protocol request bodies untouched and keep SPA fallback out of protocol paths.
- Developer identity/profile/session data must have one canonical repository and retain optimistic review behavior.
- Administrator session bootstrap must not expose session identifiers or duplicate authentication SQL outside Admin.
- Moved local edits must survive path changes while unrelated configuration remains unstaged.

---

### Task 1: Establish final common and infrastructure boundaries

**Files:**
- Move/split: `src/config.ts` → `src/infrastructure/config/config.schema.ts`
- Move/split: `src/security.ts` → `src/common/security/crypto.ts`, `password.ts`, `html.ts`
- Move: `src/http-security.ts` → `src/common/security/http-security.ts`
- Move: `src/cleanup.ts` → `src/infrastructure/maintenance/expired-data.queries.ts`
- Modify: infrastructure modules, scripts, imports, and affected tests

**Interfaces:**
- Produces `ServiceConfig`, `loadConfig`, shared security helpers, and `expiredDataQueries` at their final paths.
- Application client-secret encryption is intentionally deferred to Task 4.

- [ ] Move and split the symbols without compatibility re-export files.
- [ ] Update production, script, and test imports.
- [ ] Scan with `rg` to prove no references remain to the old paths.

### Task 2: Rewrite Account as a complete Nest module

**Files:**
- Split: `src/accounts.ts` into `src/modules/account/domain/*`, `application/*`, and `infrastructure/*`
- Modify: `src/modules/account/account.module.ts`, controllers, repositories, account tests

**Interfaces:**
- Produces injectable account resolution, claims/profile rules, account persistence, account session orchestration, and `ProviderSessionGateway`.
- Consumes the narrow administrator-session query token defined by Admin without importing Admin infrastructure.

- [ ] Move pure account identity/login/claims rules into the domain layer.
- [ ] Move the read-only PostgreSQL source into Account infrastructure.
- [ ] Convert account orchestration and repositories into injectable providers.
- [ ] Update AccountModule exports and all imports; keep the provider-session gateway as the documented late-bound port.
- [ ] Scan for old `accounts.ts` references and delete the source file.

### Task 3: Rewrite DeveloperAuth and Developer ownership

**Files:**
- Split/move: `src/developer-auth-service.ts`, `developer-email-code.ts`, `developer-identity.ts`, `developer-session.ts`, `developer-store.ts`, `email-verification.ts`
- Modify: `src/modules/developer-auth/**`, `src/modules/developer/**`, Admin consumers and developer tests

**Interfaces:**
- Developer owns identity, profile, review state, MOONDROP binding, sessions, contact-email verification, and admin review queries.
- DeveloperAuth owns credentials, registration/login, password rules, and email-code commands.
- Exports only application-facing services/tokens; concrete repositories remain private.

- [ ] Split developer domain rules from credential rules.
- [ ] Split the mixed PostgreSQL store into Developer and DeveloperAuth repositories, preserving the existing local store changes.
- [ ] Convert session, registration/login, profile/review, binding, and verification orchestration into injectable providers.
- [ ] Remove request/response types from application services and translate boundary values in controllers.
- [ ] Update module exports/imports and delete the six flat source files after reference scans are clean.

### Task 4: Rewrite Application and groups

**Files:**
- Split/move: `src/applications.ts`, `platform.ts`, `groups.ts`, `store.ts`
- Create: Application domain files, application use-case services, PostgreSQL repositories, client-secret encryption adapter
- Modify: `src/modules/application/**`, Admin/OIDC consumers and application tests

**Interfaces:**
- Produces application/group commands and queries, approved-client lookup, and cache-invalidation registration.
- Consumes Developer's profile/status query port and owns no developer SQL.

- [ ] Move draft validation and application/group state transitions into pure domain files.
- [ ] Move application/group orchestration into injectable application services.
- [ ] Split PostgreSQL application/group storage from developer data and move secret encryption into Application infrastructure.
- [ ] Update ApplicationModule and all consumers to exported application-facing providers.
- [ ] Delete the four flat source files after reference scans are clean.

### Task 5: Rewrite OIDC protocol infrastructure and Admin composition

**Files:**
- Split/move: `src/adapter.ts`, `provider.ts`, `interactions.ts`, `login-limiter.ts`, `user-portal.ts`
- Modify: `src/modules/oidc/**`, `src/modules/admin/**`, Account session composition, OIDC tests

**Interfaces:**
- OidcProviderService exclusively owns provider creation, keys, Redis subscription, late bindings, invalidation, audit, and middleware mounting.
- Admin exports a narrow administrator-session query provider; login and review adapters delegate SQL/use cases to services.

- [ ] Move adapter/provider/rate-limit implementations into OIDC infrastructure providers.
- [ ] Move direct SQL and grant transitions out of interaction/portal adapters into injected application ports.
- [ ] Preserve the user's current interaction-router changes at the new path.
- [ ] Move administrator login/session SQL behind Admin application/infrastructure providers and wire Account session bootstrap through the narrow port.
- [ ] Freeze middleware ordering in OidcModule and delete the five flat source files after reference scans are clean.

### Task 6: Complete cutover, characterization coverage, and documentation

**Files:**
- Modify: `src/app.module.ts`, module registration, tests, CI workflow, README and architecture/deployment docs
- Test: existing top-level `test/*.test.ts` files plus missing Nest HTTP cases

**Interfaces:**
- Produces the final acyclic production module graph and a clean `src/` root.

- [ ] Remove unnecessary dynamic factories/global providers and make production DI explicit.
- [ ] Add characterization cases for MOONDROP developer creation, administrator developer list/detail/review edge cases, and authenticated session bootstrap without identifier disclosure.
- [ ] Update every test/script/document import and ensure `npm run test:web` is explicit in CI.
- [ ] Verify `src/` root contains only `app.module.ts`, `main.ts`, and directories; scan for deleted-path imports and unintended cycles.
- [ ] Run `npm run check`, `npm run lint`, `npm test`, `npm run test:web`, `npm run build`, `npm run test:storage`, and `git diff --check` once on the completed rewrite.
- [ ] Run smoke checks for liveness, discovery, anonymous administrator redirect, and authorization interaction when local protected services are available.
- [ ] Commit the completed cutover with only rewrite-owned files; leave unrelated `runtime/config.example.json` unstaged.
- [ ] Request one independent whole-branch review, fix Critical/Important findings, and repeat the final verification commands if implementation changes.
