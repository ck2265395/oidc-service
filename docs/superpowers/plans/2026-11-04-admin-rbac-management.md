# Admin RBAC Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed-role authorization and complete administrator account management to the OIDC platform console.

**Architecture:** Extend the database administrator principal with a fixed role, centralize authorization and transactional invariants in the admin application service/repository, and expose guarded NestJS endpoints. The React console consumes the session role, renders an administrator page for super administrators, and forces password replacement when required.

**Tech Stack:** NestJS 12, TypeScript, PostgreSQL, React, Vitest

**Spec:** `docs/superpowers/specs/2026-11-04-admin-rbac-management-design.md`

## Global Constraints

- Do not add dependencies.
- Do not modify applied migration `004_database_administrator.sql`.
- Preserve the unrelated user change in `runtime/config.example.json`.
- Use fixed roles `super_admin`, `operator`, and `auditor`.
- Backend authorization is authoritative; frontend visibility is presentation only.

## Review Focus

- Concurrent changes must not remove the last active super administrator.
- A super administrator must not disable or change their own role.
- Temporary passwords and password hashes must not leak into audit records or list responses.
- Disabled administrators and stale sessions must immediately lose access.
- A forced-password-change session must not execute ordinary admin operations.

---

### Task 1: Administrator domain, storage, and RBAC service

**Files:**
- Create: `sql/migrations/005_admin_rbac.sql`
- Modify: `sql/postgre.sql`
- Modify: `src/modules/admin/domain/administrator.ts`
- Modify: `src/modules/admin/infrastructure/admin.repository.ts`
- Create: `src/modules/admin/application/admin-management.service.ts`
- Test: `test/admin-repository.test.ts`
- Test: `test/admin-management.test.ts`

**Interfaces:**
- Produces: role-aware `AdminPrincipal`, administrator list records, and `AdminManagementService` methods for create/status/role/reset/change-password.

- [ ] Write failing repository and management tests covering roles, generated temporary passwords, self-protection, final-super-admin protection, and session revocation.
- [ ] Run the focused tests and confirm they fail because the RBAC interfaces are absent.
- [ ] Add migration/schema changes and minimal domain, repository, and service implementation.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the task.

### Task 2: NestJS authorization and administrator APIs

**Files:**
- Modify: `src/modules/admin/admin-auth.guard.ts`
- Create: `src/modules/admin/admin-role.guard.ts`
- Create: `src/modules/admin/admin-role.decorator.ts`
- Modify: `src/modules/admin/admin.service.ts`
- Modify: `src/modules/admin/admin.controller.ts`
- Modify: `src/modules/admin/admin.module.ts`
- Modify: session response implementation under `src/modules`
- Test: `test/nest-application-admin-api.test.ts`

**Interfaces:**
- Consumes: Task 1 role-aware principal and management service.
- Produces: guarded administrator management/password endpoints and role-aware session payload.

- [ ] Write failing HTTP tests for role access, forced-password restrictions, management responses, and password validation.
- [ ] Run the focused HTTP tests and confirm expected failures.
- [ ] Implement decorators/guards, controller endpoints, dependency wiring, and session fields.
- [ ] Run the focused HTTP tests and confirm they pass.
- [ ] Commit the task.

### Task 3: Administrator console UI

**Files:**
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/styles/console.css`
- Modify: `web/src/app/ConsoleApp.test.tsx`

**Interfaces:**
- Consumes: Task 2 session role and administrator APIs.
- Produces: role-aware menu, administrator management page, one-time password display, and forced password-change page.

- [ ] Write failing Web tests for super-admin menu/actions, hidden menu for other roles, and forced password replacement.
- [ ] Run focused Web tests and confirm they fail for missing UI.
- [ ] Implement the minimal role-aware page and password-change flow.
- [ ] Run focused Web tests and confirm they pass.
- [ ] Commit the task.

### Task 4: Integrated verification

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a type-safe, fully tested administrator RBAC feature.

- [ ] Run server type checking and complete server tests.
- [ ] Run Web type checking and complete Web tests.
- [ ] Run lint and `git diff --check`.
- [ ] Fix only verified regressions using RED-GREEN tests and commit.
