# MOONDROP Developer Portal Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed-role public identity homepage with one developer-only MOONDROP open-platform portal and consolidate developer account management inside the authenticated developer console.

**Architecture:** Keep the existing same-origin React application and developer-session boundary. Make `/` the only public developer landing page, redirect `/developer` to it, remove public account/admin links, and keep `/admin/*` reachable only by a known direct URL. Preserve OIDC end-user authorization APIs while removing their React routes; add focused public documentation and truthful developer credential/binding summaries.

**Tech Stack:** React 18, React Router, TypeScript, Vite, Vitest/Testing Library, Express, PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-03-developer-portal-information-architecture-design.md`

## Global Constraints

- Do not modify `moondrop-service`; all changes stay in `oidc-service/oidc-service`.
- Do not add dependencies.
- The public UI must contain no `/admin` links or administrator capability copy.
- `/account/*` React routes are removed, but OIDC account/grant backend APIs and stored data remain unchanged.
- Email and MOONDROP login methods resolve to the same OIDC-platform developer identity; never merge identities automatically by email.
- Public pages must not request developer, account, or administrator session data.
- Keep `/admin/*` authentication and session isolation unchanged.

## Review Focus

- Direct visits to removed `/account/*` routes must not expose a stale account console; Task 1 tests redirect them to the public portal.
- Public source and rendered navigation must contain no `/admin` URL or “运营管理后台” entry; Task 1 tests both rendered output and legacy HTML.
- Direct `/admin/login` access must remain functional after public-link removal; Task 1 retains the server route test.
- `/developer/docs` must render without calling a private session API; Task 2 asserts zero fetch calls.
- Developer security/account summaries must not claim an email credential or MOONDROP binding that the database does not contain; Task 3 exercises email-only, MOONDROP-only and dual-method identities.

---

### Task 1: Developer-only public portal and route boundary

**Files:**
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/app/DeveloperPublic.tsx`
- Modify: `web/src/styles/console.css`
- Modify: `web/src/app/ConsoleApp.test.tsx`
- Modify: `web/src/app/DeveloperPublic.test.tsx`
- Modify: `public/index.html`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: existing `DeveloperLanding`, `DeveloperLogin`, `DeveloperRegister`, and `DeveloperBinding` components.
- Produces: `/` developer landing route; `/developer` redirect; legacy developer-console paths redirected under `/developer/console/*`; no React `/account/*` route; unchanged direct `/admin/*` routes.

- [ ] **Step 1: Write failing public-boundary tests**

  Add tests named `public portal exposes only developer actions`, `removed account routes return to the developer portal`, and `public sources contain no administrator entry`. Assert `/` shows registration, login and docs; does not show account/admin links or copy; `/developer` redirects to `/`; `/account/profile` does not render the account console; and `public/index.html` contains no `/admin` link.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `npm run test:web -- DeveloperPublic.test.tsx ConsoleApp.test.tsx`

  Expected: FAIL because `/` still renders account/admin role cards and `/account/*` still mounts `ConsoleShell`.

- [ ] **Step 3: Implement the single public portal**

  Make `DeveloperLanding` the `/` element, redirect `/developer` to `/`, remove `/account` and `/account/*` React routes, and keep `/admin/*` routes without adding a discoverable link. Redirect existing `/developer/overview`, `/developer/profile`, `/developer/applications`, and `/developer/groups` bookmarks to their `/developer/console/*` equivalents rather than retaining a catch-all private console under the public namespace. Update the hero and sections to expose exactly `/developer/register`, `/developer/login`, and `/developer/docs` as primary actions. Remove the obsolete `PublicHome` component and the legacy admin/account cards from `public/index.html`.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run: `npm run test:web -- DeveloperPublic.test.tsx ConsoleApp.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Verify server routing compatibility**

  Run: `npm test -- test/app.test.ts`

  Expected: PASS, including direct `/admin/login` and SPA fallback behavior.

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/app/ConsoleApp.tsx web/src/app/DeveloperPublic.tsx web/src/styles/console.css web/src/app/ConsoleApp.test.tsx web/src/app/DeveloperPublic.test.tsx public/index.html test/app.test.ts
  git commit -m "feat: make public portal developer-only"
  ```

### Task 2: Public developer documentation hub

**Files:**
- Create: `web/src/app/DeveloperDocs.tsx`
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/app/DeveloperPublic.tsx`
- Modify: `web/src/styles/console.css`
- Create: `web/src/app/DeveloperDocs.test.tsx`
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: public header/brand patterns from `DeveloperPublic.tsx` and existing `/developer/docs` route.
- Produces: `DeveloperDocs(): JSX.Element`, a public, session-free documentation index with stable section anchors.

- [ ] **Step 1: Write failing documentation tests**

  Add `developer docs cover the complete onboarding path without private requests`. Assert headings/links for quick start, becoming a developer, creating an application, OIDC/OAuth, Web/SPA/Native, API and errors, review rules, and FAQ; assert a fetch spy is never called.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm run test:web -- DeveloperDocs.test.tsx`

  Expected: FAIL because the current `DocsPage` contains only a short three-step panel.

- [ ] **Step 3: Implement `DeveloperDocs` and public navigation**

  Create a public documentation layout with a searchable-looking but non-functional navigation only if backed by actual anchors; otherwise use category cards and an on-page table of contents. Include concrete MOONDROP OIDC values already supported by the service: Authorization Code, PKCE, discovery endpoint, exact redirect URI matching, Web/SPA/Native types, approval requirement, and links to the relevant sections in `docs/api.md`. Do not copy QQ wording or claim SDKs/debugging tools that do not exist.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run: `npm run test:web -- DeveloperDocs.test.tsx`

  Expected: PASS with zero fetch calls.

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/app/DeveloperDocs.tsx web/src/app/DeveloperDocs.test.tsx web/src/app/ConsoleApp.tsx web/src/app/DeveloperPublic.tsx web/src/styles/console.css docs/api.md
  git commit -m "feat: add public developer documentation hub"
  ```

### Task 3: Unified developer account, review and security navigation

**Files:**
- Modify: `src/developer-store.ts`
- Modify: `src/developer-auth.ts`
- Modify: `test/developer-store.test.ts`
- Modify: `test/developer-auth-api.test.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/app/ConsoleApp.tsx`
- Modify: `web/src/app/DeveloperReviewUi.test.tsx`

**Interfaces:**
- Consumes: `developer_password_credential`, `developer_external_identity`, developer session resolution, profile and review-history APIs.
- Produces: `PostgresDeveloperStore.listAuthenticationMethods(developerId: string): Promise<Array<'email' | 'moondrop'>>`; `AuthDependencies.identities: Pick<PostgresDeveloperStore, 'listAuthenticationMethods'>`; developer session payload field `authenticationMethods`; console routes for personal profile, developer review and security summary.

- [ ] **Step 1: Write failing repository and API tests**

  Add tests for email-only, MOONDROP-only and dual-method developers. Assert `GET /api/v1/developer-auth/session` returns only methods backed by credential/external-identity rows and never returns email addresses, password digests or external subjects.

- [ ] **Step 2: Run server tests and verify RED**

  Run: `npm test -- test/developer-store.test.ts test/developer-auth-api.test.ts`

  Expected: FAIL because session data has no authentication-method summary.

- [ ] **Step 3: Implement authentication-method summary**

  Add `listAuthenticationMethods` using existence checks scoped by `developer_id`; return stable method names only. Pass the repository into `createDeveloperAuthRouter` as `identities`, and extend the authenticated session response without exposing credential identifiers.

- [ ] **Step 4: Run server tests and verify GREEN**

  Run: `npm test -- test/developer-store.test.ts test/developer-auth-api.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing console navigation tests**

  Assert the authenticated developer navigation contains overview, personal profile, developer review, applications, groups, security settings and docs. Assert security settings display only methods returned by the session API and mark password change, unlinking and device/session management as unavailable when no backend operation exists.

- [ ] **Step 6: Run focused web tests and verify RED**

  Run: `npm run test:web -- DeveloperReviewUi.test.tsx`

  Expected: FAIL because profile/review are combined and no security page exists.

- [ ] **Step 7: Implement developer console sections**

  Split presentation routes without duplicating server state: personal profile edits the existing profile; developer review shows status/submission/history; security settings consumes `authenticationMethods` and contains no fake mutation controls. Remove all account-console terminology from developer pages.

- [ ] **Step 8: Run focused web tests and verify GREEN**

  Run: `npm run test:web -- DeveloperReviewUi.test.tsx`

  Expected: PASS.

- [ ] **Step 9: Commit**

  ```bash
  git add src/developer-store.ts src/developer-auth.ts test/developer-store.test.ts test/developer-auth-api.test.ts web/src/api.ts web/src/app/ConsoleApp.tsx web/src/app/DeveloperReviewUi.test.tsx
  git commit -m "feat: unify developer account management"
  ```

### Task 4: Full verification and generated frontend artifact

**Files:**
- Modify: `public/app/index.html`
- Modify: `public/app/assets/*`
- Modify: `docs/progress.md`

**Interfaces:**
- Consumes: Tasks 1–3 routes, components and APIs.
- Produces: deployable production SPA artifact and updated implementation status.

- [ ] **Step 1: Run complete verification**

  Run: `npm run check`

  Expected: server and web TypeScript checks PASS.

  Run: `npm run lint`

  Expected: ESLint PASS.

  Run: `npm test`

  Expected: all server tests PASS.

  Run: `npm run test:web`

  Expected: all web tests PASS.

- [ ] **Step 2: Build the production application**

  Run: `npm run build`

  Expected: server compilation and Vite production build PASS; `public/app/index.html` references the newly generated hashed assets.

- [ ] **Step 3: Check public-entry leakage and whitespace**

  Run: `rg -n "(/admin|运营管理后台|账号中心)" web/src/app/DeveloperPublic.tsx web/src/app/DeveloperDocs.tsx public/index.html`

  Expected: no matches. Separately inspect `ConsoleApp.tsx`: `/admin/*` route declarations may remain, but no public component may render an administrator or account-center link.

  Run: `git diff --check`

  Expected: no whitespace errors.

- [ ] **Step 4: Record deployment behavior and commit**

  Update `docs/progress.md` with the developer-only public boundary, hidden direct admin entry, removed account React routes, preserved OIDC grant APIs and public documentation scope.

  ```bash
  git add public/app docs/progress.md
  git commit -m "docs: record developer portal boundary"
  ```
