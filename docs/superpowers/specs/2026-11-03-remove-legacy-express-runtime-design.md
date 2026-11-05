# Remove Legacy Express Runtime Design

## Intent

The NestJS runtime is now the only supported runtime. Remove the rollback-only Express composition and every HTTP adapter that is reachable only from that entry, while preserving domain services and the three Express routers still mounted intentionally inside Nest: OIDC interactions, the user portal, and administrator login.

## Goals

- Remove `start:legacy` and `src/legacy-main.ts`.
- Delete unused legacy HTTP composition and routers for account, session, developer, administrator API, and generic web hosting.
- Remove tests that exercise only the deleted runtime, while retaining or moving contract assertions that still apply to Nest.
- Reduce the legacy administrator HTML router to the login flow actually mounted by Nest.
- Update current architecture, deployment, and README documentation so no rollback command is advertised.
- Preserve all Nest routes, response envelopes, cookies, OIDC behavior, database behavior, and frontend assets.

## Non-goals

- Do not rewrite `oidc-provider`, `interactions.ts`, or `user-portal.ts`; Nest still mounts them as native protocol/business middleware.
- Do not move domain services such as `accounts.ts`, `platform.ts`, `groups.ts`, `developer-store.ts`, or `store.ts` merely because they remain at the `src/` root.
- Do not change SQL, protected configuration, authentication policy, or public APIs.
- Do not modify the user's unrelated uncommitted files.

## Approaches

### Selected: reachability-based cleanup

Delete only code whose production reachability ends at `legacy-main.ts`. Extract the administrator-session helper before deleting `session-api.ts`, and replace the oversized legacy administrator router with a login-only router used by `AdminModule`. This produces a smaller codebase without changing the active OIDC flow.

### Rejected: delete only the legacy entry point

This leaves multiple dead routers, tests, scripts, and documentation in the repository and does not satisfy the cleanup goal.

### Deferred: pure-Nest rewrite of every remaining Express router

Rewriting interactions and the portal would touch the security-critical OIDC flow even though those routers are active rather than obsolete. That is a separate migration with its own compatibility plan.

## Deletion and Refactoring Boundary

Delete production files used only by the legacy composition:

- `src/legacy-main.ts`
- `src/app.ts`
- `src/account-api.ts`
- `src/admin-api.ts`
- `src/developer-auth.ts`
- `src/developer.ts`
- `src/session-api.ts`
- `src/user-api.ts`

Replace `src/admin.ts` with a focused `src/modules/admin/admin-login.router.ts` containing only administrator login GET/POST behavior. Move administrator-session validation into `PostgresAdminAuth` so it no longer imports `session-api.ts`.

Delete legacy-only tests and simplify `test/fixtures/service-config.ts` to configuration fixtures only. Keep Nest contract, protocol, domain, infrastructure, and storage tests. Port any still-relevant secure-cookie and direct-login assertions into Nest tests before deleting their old counterparts.

## Safety and Verification

- Begin with tests proving the Nest administrator login and secure developer cookie contracts remain covered.
- Add a repository test asserting `start:legacy` and legacy runtime source files are absent.
- Use import/reference searches to prove no deleted module remains referenced.
- Run TypeScript checks, ESLint, all server tests, all web tests, build, and `git diff --check`.
- Perform read-only runtime checks for health, discovery, administrator login, anonymous administrator redirect, and OIDC authorization redirect.

## Constraints

- No new dependencies.
- Stage and commit only files belonging to this cleanup.
- Preserve `runtime/config.example.json`, `src/developer-store.ts`, `src/interactions.ts`, and `test/developer-store.test.ts` local changes unless this design explicitly requires a conflict-free reference-only read.
