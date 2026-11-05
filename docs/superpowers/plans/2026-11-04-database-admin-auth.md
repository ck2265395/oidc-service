# Database Administrator Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate administrators from PostgreSQL and initialize `admin / 123456` only for an empty local-development database.

**Architecture:** The Admin module owns administrator credentials, bootstrap, sessions, and audit identity. A PostgreSQL repository supplies a transport-neutral authentication service; the login router and guards remain HTTP adapters. Runtime configuration no longer contains an administrator password hash.

**Tech Stack:** NestJS 12, TypeScript, PostgreSQL/pg, Node scrypt, node:test

**Spec:** `docs/superpowers/specs/2026-11-04-database-admin-auth-design.md`

## Global Constraints

- Never store or log the plaintext default password.
- Create `admin / 123456` only in local development and only when no administrator exists.
- Test and production modes must never create a default administrator.
- Preserve current origin, CSRF, rate-limit, cookie, and generic login-error behavior.
- Add no dependencies.

## Review Focus

- Two local cluster workers start concurrently: exactly one default administrator exists.
- An administrator row exists but is disabled: login fails generically and no session is created.
- A stale session references a disabled or deleted administrator: authentication fails closed.
- A production configuration starts with an empty administrator table: no weak account is created.
- A duplicate or case-variant username cannot create ambiguous authentication.

---

### Task 1: Administrator schema and repository

**Files:**
- Modify: `sql/postgre.sql`
- Modify: `sql/migrations/001_initial_schema.sql`
- Create: `sql/migrations/004_database_administrator.sql`
- Create: `src/modules/admin/domain/administrator.ts`
- Create: `src/modules/admin/infrastructure/admin.repository.ts`
- Test: `test/admin-repository.test.ts`

**Interfaces:**
- Produces: `AdminPrincipal`, `AdminCredential`, and `PostgresAdminRepository.findCredential(username)`, `createLocalDefault()`, `createSession(adminId, sessionHash)`, `resolveSession(sessionHash)`.

- [ ] Write repository tests proving parameterized credential lookup, disabled-account rejection, conflict-safe local initialization, session ownership, and disabled-session rejection.
- [ ] Run the new test and verify it fails because the schema/repository do not exist.
- [ ] Add `platform_admin`; add nullable `admin_id` safely for existing sessions, then enforce it for newly created sessions in repository operations; add indexes and the additive migration.
- [ ] Implement the repository with normalized unique usernames and transaction/advisory-lock-safe `createLocalDefault`.
- [ ] Run the repository test and verify it passes.
- [ ] Commit with `feat: add database administrator repository`.

### Task 2: Authentication and local bootstrap

**Files:**
- Create: `src/modules/admin/application/admin-authentication.service.ts`
- Create: `src/modules/admin/application/admin-bootstrap.service.ts`
- Modify: `src/modules/admin/infrastructure/admin-auth.ts`
- Modify: `src/modules/admin/admin.module.ts`
- Test: `test/admin-database-auth.test.ts`

**Interfaces:**
- Consumes: Task 1 repository methods.
- Produces: `AdminAuthenticationService.login(username, password)` and principal-returning `AdminAuthPort.authenticated(request)`.

- [ ] Write tests for valid/invalid/disabled credentials, local-only idempotent bootstrap, production no-op, and session principal resolution.
- [ ] Run the tests and verify they fail for missing application services.
- [ ] Implement random-salt scrypt hashing for the local six-character default without weakening developer/account password validation.
- [ ] Implement bootstrap as a Nest lifecycle provider gated by parsed local mode.
- [ ] Make session authentication return `AdminPrincipal | null` and fail closed.
- [ ] Run the tests and verify they pass.
- [ ] Commit with `feat: authenticate administrators from database`.

### Task 3: Login and audit integration

**Files:**
- Modify: `src/modules/admin/admin-login.router.ts`
- Modify: `src/modules/admin/admin-auth.guard.ts`
- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/modules/account/controllers/session.controller.ts`
- Modify: `src/modules/admin/infrastructure/admin-audit.repository.ts`
- Modify: `test/admin-origin.test.ts`
- Modify: `test/nest-account-api.test.ts`
- Modify: `test/nest-application-admin-api.test.ts`

**Interfaces:**
- Consumes: Task 2 authentication/principal APIs.
- Produces: database-backed login/session behavior and stable administrator audit actors.

- [ ] Change characterization tests so login credentials and session principals come from the repository, and assert no config credential fallback.
- [ ] Run the affected tests and verify they fail against the current config-backed router.
- [ ] Inject authentication into the login router, create sessions for the returned admin ID, expose the actual username in `/api/v1/session`, and use the principal ID in review/audit actions.
- [ ] Preserve generic errors, rate limiting, CSRF, and cookie settings.
- [ ] Run affected tests and verify they pass.
- [ ] Commit with `refactor: use administrator principals across console`.

### Task 4: Configuration migration and full verification

**Files:**
- Modify: `src/infrastructure/config/config.schema.ts`
- Modify: `runtime/config.example.json`
- Modify: `test/config.test.ts`
- Modify: `test/config-layout.test.ts`
- Replace: `scripts/admin-password.ts` with `scripts/admin-create.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: database-backed authentication from Tasks 1–3.
- Produces: runtime configuration with no administrator credential secret.

- [ ] Update configuration tests to reject obsolete admin password fields and accept configurations without administrator credentials.
- [ ] Run configuration tests and verify they fail against the old schema.
- [ ] Remove `admin.username/passwordHash` from `ServiceConfig` and tracked examples; replace the obsolete hash-file script with `npm run admin:create`, which prompts securely and inserts a database administrator without printing credentials; document local initialization and explicit production provisioning.
- [ ] Run configuration tests and verify they pass.
- [ ] Run TypeScript, ESLint, all server tests, web tests, storage test, production builds, and `git diff --check`.
- [ ] Commit with `refactor: remove configured administrator credentials`.
