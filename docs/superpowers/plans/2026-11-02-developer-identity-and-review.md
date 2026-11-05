# Developer Identity and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent MOONDROP developer identity domain with email/password and MOONDROP login, secure account linking, developer qualification review, and approval-gated application creation.

**Architecture:** PostgreSQL owns durable developer identities, credentials, sessions, profiles, reviews, and resource ownership; Redis owns short-lived email codes and rate limits. A dedicated developer-auth router creates developer sessions independently of the existing end-user OIDC session, while MOONDROP OIDC login is used only to prove an external identity before binding it. The React application exposes a public developer portal and authentication pages separately from the protected developer console.

**Tech Stack:** Node.js 24, TypeScript 6, Express 5, PostgreSQL, Redis 6, Node `crypto` (`scrypt`), nodemailer, React 18, React Router, Vite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-developer-identity-and-review-design.md`

## Global Constraints

- Do not write to or change `moondrop-service`; its account database remains a read-only external identity source.
- Do not add dependencies; use the packages and Node.js APIs already present in `package.json`.
- Developer status is exactly `unsubmitted | pending | approved | rejected | disabled`.
- Email verification codes are six digits, expire after 10 minutes, are one-time use, and are stored in Redis only as keyed digests.
- Developer sessions have a 7-day sliding lifetime and a 30-day absolute lifetime; database stores only SHA-256 token digests.
- Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`; all mutations retain origin and CSRF validation.
- Never auto-link accounts by matching email; linking requires developer password or a fresh developer-email code.
- Only `approved` developers can create applications or application groups; backend service checks are authoritative.
- Existing developers and orphaned application owners migrate as approved and remain accessible through their MOONDROP account.
- API responses retain `{code, desc, data}` and login failures do not reveal whether an email exists.

## Review Focus

- Concurrent registration or binding for the same normalized email/MOONDROP UUID must create one identity and return a safe 409 for the loser; covered in Task 3 and Task 5 tests.
- Redis failure after a code request or during consumption must not create a partial developer account or permit code replay; covered in Task 3 tests.
- A developer disabled while holding active sessions must lose access on the next request and all session rows must be revoked; covered in Task 4 and Task 7 tests.
- Existing owners without `developer_profile` must receive a migration identity without losing application/group ownership; covered in Task 2 migration tests.
- Direct API calls must not bypass UI gating for application/group creation, including stale approved sessions after rejection/disable; covered in Task 6 tests.

---

## File Map

- `src/developer-identity.ts`: domain types, status transitions, email normalization, password hashing and verification.
- `src/developer-store.ts`: PostgreSQL repository for accounts, credentials, profiles, sessions, external identities and developer reviews.
- `src/developer-auth.ts`: email-code registration/login/logout/session endpoints and MOONDROP binding endpoints.
- `src/developer-session.ts`: cookie parsing, session creation/resolution/revocation and CSRF helpers for developer APIs.
- `src/developer-email-code.ts`: Redis code issuance/consumption and registration/binding mail delivery.
- `src/developer.ts`: protected profile, qualification submission and application/group endpoints using developer identity.
- `src/admin-api.ts`: administrator developer listing/detail/review endpoints.
- `src/platform.ts`: approval guard before resource creation.
- `src/store.ts`: application/group ownership terminology and repository queries keyed by developer ID.
- `src/app.ts`, `src/main.ts`, `src/config.ts`: router wiring, callbacks and configuration.
- `sql/migrations/003_developer_identity.sql`, `sql/postgre.sql`: schema and compatibility migration.
- `web/src/app/DeveloperPublic.tsx`: public portal, login, registration and MOONDROP binding screens.
- `web/src/app/DeveloperConsole.tsx`: protected developer overview/profile/security/application UI.
- `web/src/app/AdminDevelopers.tsx`: developer review administration UI.
- `web/src/app/ConsoleApp.tsx`: top-level route composition and shared shell only.
- `web/src/api.ts`: developer-auth session and CSRF client helpers.

### Task 1: Developer identity domain and password primitives

**Files:**
- Create: `src/developer-identity.ts`
- Create: `test/developer-identity.test.ts`

**Interfaces:**
- Produces: `DeveloperStatus`, `DeveloperAccount`, `DeveloperProfile`, `DeveloperReview`, `normalizeDeveloperEmail(value: string): string`, `hashDeveloperPassword(password: string): Promise<PasswordDigest>`, `verifyDeveloperPassword(password: string, digest: PasswordDigest): Promise<boolean>`, `assertDeveloperTransition(from: DeveloperStatus, action: DeveloperReviewAction): DeveloperStatus`.

- [ ] **Step 1: Write failing domain tests**

  Add tests named `normalizes_email_without_locale_rules`, `rejects_invalid_email_and_weak_password`, `password_digest_round_trips_and_rejects_wrong_password`, and `developer_review_state_machine_allows_only_defined_transitions`. Assert the five exact statuses and that `pending` can only become `approved` or `rejected`, while `disabled` requires an administrator restore action.

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `npm test -- --test-name-pattern="developer|password|email" test/developer-identity.test.ts`
  Expected: FAIL because `src/developer-identity.ts` does not exist.

- [ ] **Step 3: Implement domain types and primitives**

  Use `scrypt` with a random 16-byte salt, versioned parameters and `timingSafeEqual`. Enforce email length 254 and a password policy of 10–128 characters containing at least three of uppercase, lowercase, digit and symbol.

- [ ] **Step 4: Run the focused test**

  Run: `npm test -- test/developer-identity.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: add developer identity domain"`

### Task 2: PostgreSQL schema, compatibility migration and repository

**Files:**
- Create: `sql/migrations/003_developer_identity.sql`
- Modify: `sql/postgre.sql`
- Create: `src/developer-store.ts`
- Create: `test/storage/developer-store.test.ts`
- Modify: `test/storage/migrations.test.ts` if present; otherwise create it.

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `DeveloperStore` methods `createEmailAccount`, `findCredentialByEmail`, `findAccount`, `findByExternalIdentity`, `bindExternalIdentity`, `getProfile`, `saveProfile`, `createSession`, `resolveSession`, `revokeSession`, `revokeAllSessions`, `submitReview`, `reviewDeveloper`, `listForAdmin`, and `getForAdmin`.

- [ ] **Step 1: Write failing storage and migration tests**

  Assert unique normalized email and `(provider, subject)`, transactional account creation, hashed session lookup, optimistic profile/review revisions, immutable review history, idempotent migration, preservation of existing owners, and creation of approved compatibility identities for orphan owners.

- [ ] **Step 2: Run storage tests and confirm failure**

  Run: `npm run test:storage -- --test-name-pattern="developer|migration"`
  Expected: FAIL because migration 003 and repository are absent.

- [ ] **Step 3: Add migration 003**

  Create `developer_account`, `developer_password_credential`, `developer_external_identity`, `developer_session`, and `developer_review_history`; reshape `developer_profile` to use `developer_id`; backfill identities and owner values using deterministic migration mappings; add indexes, foreign keys where safe, and rerunnable guards.

- [ ] **Step 4: Implement `PostgresDeveloperStore`**

  Keep every multi-row identity operation in a transaction and convert PostgreSQL uniqueness/version conflicts into typed store conflicts without exposing sensitive values.

- [ ] **Step 5: Synchronize the full schema and run storage tests**

  Run: `npm run test:storage -- --test-name-pattern="developer|migration"`
  Expected: PASS with no owner-count mismatch.

- [ ] **Step 6: Commit**

  `git commit -m "feat: persist developer identities"`

### Task 3: Email codes, registration and password login service

**Files:**
- Create: `src/developer-email-code.ts`
- Create: `src/developer-auth-service.ts`
- Create: `test/developer-auth-service.test.ts`
- Modify: `src/email-verification.ts` only to share the existing configured mail transport, not its contact-email token flow.

**Interfaces:**
- Consumes: `DeveloperStore`, Task 1 password helpers, configured Redis and SMTP sender.
- Produces: `DeveloperEmailCode.issue(purpose, email, ip): Promise<'sent'>`, `consume(purpose, email, code): Promise<boolean>` and `DeveloperAuthService.register`, `loginWithPassword`, `verifyLinkCredential`, `changePassword`, `resetPassword`.

- [ ] **Step 1: Write failing service tests**

  Cover six-digit generation, HMAC digest storage, 600-second TTL, one-time consumption, purpose separation (`register | bind | reset`), email/IP rate limits, Redis/mail rollback, concurrent duplicate registration, generic wrong-credential errors, constant-work unknown-email login, authenticated password change and email-code password reset that revokes existing sessions.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm test -- test/developer-auth-service.test.ts`
  Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement email-code delivery and auth service**

  Use Redis `SET NX EX` and a server-side HMAC key derived from protected configuration. Registration consumes the code before a single PostgreSQL transaction creates account, credential and initial profile; a database conflict returns a safe account-exists result.

- [ ] **Step 4: Run focused tests**

  Run: `npm test -- test/developer-auth-service.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: add developer email authentication"`

### Task 4: Developer sessions and authentication API

**Files:**
- Create: `src/developer-session.ts`
- Create: `src/developer-auth.ts`
- Create: `test/developer-auth-api.test.ts`
- Modify: `src/app.ts`
- Modify: `src/main.ts`
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`

**Interfaces:**
- Consumes: Task 2 store and Task 3 service.
- Produces: `DeveloperSessionService.create`, `resolve`, `revoke`, `revokeAll`; `requireDeveloper(request, response)`; router mounted at `/api/v1/developer-auth`.

- [ ] **Step 1: Write failing config and API tests**

  Test email-code, register, login, logout, session, change-password and reset-password endpoints; exact cookie security attributes; CSRF/origin rejection; 7-day activity extension capped at 30 days; generic login errors; and immediate rejection/revocation when account status is `disabled`.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm test -- test/config.test.ts test/developer-auth-api.test.ts`
  Expected: FAIL because developer auth routes/config are absent.

- [ ] **Step 3: Implement session service and API router**

  Mount `/api/v1/developer-auth` before the SPA fallback. Keep the existing end-user OIDC and admin cookies separate with a dedicated developer cookie name and CSRF token.

- [ ] **Step 4: Wire protected configuration**

  Add only non-secret validation fields to config types; load the email-code HMAC secret through the existing protected `runtime/config.json` mechanism without logging it.

- [ ] **Step 5: Run focused tests**

  Run: `npm test -- test/config.test.ts test/developer-auth-api.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git commit -m "feat: add developer sessions and auth api"`

### Task 5: MOONDROP login and secure developer account binding

**Files:**
- Modify: `src/user-portal.ts`
- Modify: `src/developer-auth.ts`
- Modify: `src/developer-auth-service.ts`
- Create: `test/developer-moondrop-binding.test.ts`

**Interfaces:**
- Consumes: existing self-client OIDC authorization, `AccountService`, developer session service and `DeveloperStore.bindExternalIdentity`.
- Produces: one-time binding context and endpoints for `/moondrop/start`, `/moondrop/create`, and `/moondrop/bind`.

- [ ] **Step 1: Write failing binding tests**

  Cover existing binding direct login, first-login choice screen, new identity creation, password-confirmed binding, email-code-confirmed binding, refusal to auto-link matching emails, one-time context replay, concurrent binding of the same MOONDROP UUID and safe return-path validation.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm test -- test/developer-moondrop-binding.test.ts test/user-portal-login.test.ts`
  Expected: new binding tests FAIL while existing portal regression remains PASS.

- [ ] **Step 3: Implement binding context and callbacks**

  Store a hashed, 10-minute, one-time binding context containing the verified MOONDROP account UUID. Creating or binding consumes it transactionally before establishing a developer session.

- [ ] **Step 4: Run focused tests**

  Run: `npm test -- test/developer-moondrop-binding.test.ts test/user-portal-login.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: link moondrop developer identities"`

### Task 6: Developer profile review and approval-gated resources

**Files:**
- Modify: `src/developer.ts`
- Modify: `src/platform.ts`
- Modify: `src/groups.ts`
- Modify: `src/store.ts`
- Modify: `test/platform.test.ts`
- Create: `test/developer-review.test.ts`

**Interfaces:**
- Consumes: `requireDeveloper`, `DeveloperStore`, migrated developer IDs.
- Produces: `GET/PUT /profile`, `POST /review/submit`, `GET /review/history`; `ApplicationService.createWithSecret(..., developerStatus)` and `ApplicationGroupService.create(..., developerStatus)` approval enforcement.

- [ ] **Step 1: Write failing review and permission tests**

  Assert required profile fields and verified contact email, profile lock while pending, rejected edit/re-submit, visible reason/history, approved creation, denial for every other status, and denial after stale sessions when a developer becomes rejected/disabled.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm test -- test/developer-review.test.ts test/platform.test.ts`
  Expected: FAIL on missing review endpoints and approval guards.

- [ ] **Step 3: Replace OIDC end-user ownership with developer session ownership**

  Update all developer routes to resolve `developerId`; expose status/profile/review data without returning password, token or external subject secrets.

- [ ] **Step 4: Add service-level creation guards**

  Resource creation reads current status from PostgreSQL at operation time. Existing resource management remains available unless the account is disabled, as specified.

- [ ] **Step 5: Run focused tests**

  Run: `npm test -- test/developer-review.test.ts test/platform.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git commit -m "feat: require developer approval for applications"`

### Task 7: Administrator developer review API

**Files:**
- Modify: `src/admin-api.ts`
- Create: `test/admin-developers.test.ts`

**Interfaces:**
- Consumes: `DeveloperStore.listForAdmin`, `getForAdmin`, `reviewDeveloper`, existing admin authentication/CSRF middleware.
- Produces: `GET /api/v1/admin/developers`, `GET /api/v1/admin/developers/:id`, `POST /api/v1/admin/developers/:id/review`.

- [ ] **Step 1: Write failing admin API tests**

  Cover status filtering/pagination, submitted profile snapshot, approve, mandatory reject/disable reason, optimistic conflict, restore, immutable history, unauthorized access, and revocation of all sessions after disable.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm test -- test/admin-developers.test.ts test/admin-api.test.ts`
  Expected: new tests FAIL and existing admin tests remain PASS.

- [ ] **Step 3: Implement admin developer endpoints**

  Use the current admin identity as reviewer and write corresponding `platform_audit` events without logging contact data or credentials.

- [ ] **Step 4: Run focused tests**

  Run: `npm test -- test/admin-developers.test.ts test/admin-api.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: add developer qualification review"`

### Task 8: Public developer portal and authentication UI

**Files:**
- Create: `web/src/app/DeveloperPublic.tsx`
- Create: `web/src/app/DeveloperPublic.test.tsx`
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/styles/console.css`

**Interfaces:**
- Consumes: developer-auth API from Tasks 4–5.
- Produces: public routes `/developer`, `/developer/docs`, `/developer/login`, `/developer/register`, `/developer/link`; protected route redirect to `/developer/login?returnTo=...`.

- [ ] **Step 1: Write failing UI tests**

  Assert unauthenticated `/developer` shows only portal/features and no console sidebar, registration is email-code/password only, login offers email password and MOONDROP, binding never suggests automatic email merge, and unsafe return URLs are discarded.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm run test:web -- DeveloperPublic.test.tsx`
  Expected: FAIL because the public developer routes do not exist.

- [ ] **Step 3: Implement portal and auth pages**

  Reuse the MOONDROP brand/icon and current visual tokens. Keep forms accessible, show field-level errors, preserve cooldown state for email-code resend and avoid rendering private API data before session resolution.

- [ ] **Step 4: Run focused web tests**

  Run: `npm run test:web -- DeveloperPublic.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: add developer portal and sign in"`

### Task 9: Developer console status, profile and security UI

**Files:**
- Create: `web/src/app/DeveloperConsole.tsx`
- Create: `web/src/app/DeveloperConsole.test.tsx`
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/styles/console.css`

**Interfaces:**
- Consumes: developer session/profile/review/application APIs.
- Produces: `/developer/console/overview`, `/profile`, `/applications`, `/groups`, `/security`; compatibility redirects from existing `/developer/overview` and related paths.

- [ ] **Step 1: Write failing console tests**

  Assert the five status labels and reasons, manual submit flow, pending profile lock, rejected edit/re-submit, approved-only create buttons, backend denial display, optional unverified phone field, linked MOONDROP status and safe logout.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm run test:web -- DeveloperConsole.test.tsx ConsoleApp.test.tsx`
  Expected: new tests FAIL and current routing assertions identify compatibility changes.

- [ ] **Step 3: Implement protected console**

  Split developer-specific pages out of the oversized shared `ConsoleApp.tsx`; retain shared brand, table and feedback primitives. Always render server-provided developer status rather than inferring it from profile/application state.

- [ ] **Step 4: Run focused web tests**

  Run: `npm run test:web -- DeveloperConsole.test.tsx ConsoleApp.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: show developer status in console"`

### Task 10: Administrator developer review UI

**Files:**
- Create: `web/src/app/AdminDevelopers.tsx`
- Create: `web/src/app/AdminDevelopers.test.tsx`
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/styles/console.css`

**Interfaces:**
- Consumes: Task 7 admin APIs and existing admin CSRF helper.
- Produces: `/admin/developers` and `/admin/developers/:id` pages plus admin sidebar item.

- [ ] **Step 1: Write failing admin UI tests**

  Assert status filters, developer identity types, profile snapshot, review history, approve action, mandatory reject/disable reason, conflict refresh message and restored state.

- [ ] **Step 2: Run and confirm failure**

  Run: `npm run test:web -- AdminDevelopers.test.tsx`
  Expected: FAIL because review pages do not exist.

- [ ] **Step 3: Implement list/detail review pages**

  Add “开发者审核” before application review in navigation; reuse status and data-table components while keeping contact data confined to authorized admin detail views.

- [ ] **Step 4: Run focused web tests**

  Run: `npm run test:web -- AdminDevelopers.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: add developer review console"`

### Task 11: Full integration, operational checks and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `scripts/clean-expired.ts`
- Modify: `test/app.test.ts`
- Modify: `test/security.test.ts`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: documented setup/migration/runbook and expiry cleanup for developer sessions/codes.

- [ ] **Step 1: Add integration and security regression tests**

  Exercise the complete email registration → profile → submit → admin approve → create application flow and MOONDROP login → secure bind → same application list flow. Add assertions for account enumeration, CSRF, open redirect, code replay and disabled-session access.

- [ ] **Step 2: Run new integration tests and fix only uncovered integration defects**

  Run: `npm test -- test/app.test.ts test/security.test.ts`
  Expected: PASS.

- [ ] **Step 3: Document configuration and migration**

  Document protected email-code HMAC configuration, SMTP dependency, migration 003 preflight/count checks, rollback boundary, public/private routes and developer/admin API contracts without including real secrets or `.env` contents.

- [ ] **Step 4: Extend expiry cleanup**

  Delete expired/revoked developer sessions after the documented retention interval; Redis code keys remain TTL-managed.

- [ ] **Step 5: Run complete verification**

  Run: `npm run check`
  Expected: TypeScript checks PASS for server and web.

  Run: `npm run lint`
  Expected: ESLint PASS.

  Run: `npm test`
  Expected: all server tests PASS.

  Run: `npm run test:web`
  Expected: all web tests PASS.

  Run: `npm run build`
  Expected: server and production web builds PASS.

  Run: `git diff --check`
  Expected: no whitespace errors.

- [ ] **Step 6: Perform migration dry-run against a disposable database**

  Record before/after developer, application and group counts; verify there are zero unmapped owners and a second migration run makes no changes.

- [ ] **Step 7: Commit**

  `git commit -m "docs: document developer identity operations"`
