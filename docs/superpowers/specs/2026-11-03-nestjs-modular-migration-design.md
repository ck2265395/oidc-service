# NestJS modular migration design

## Intent

The identity platform has grown from a small OIDC protocol service into a combined identity provider, developer platform, account portal, application-review system, administrator console, and React host. Its Express implementation is functional, but backend files are flat under `src/`, dependency composition is concentrated in `main.ts`, request logging is absent, and routing, validation, error mapping, and lifecycle behavior rely on local conventions rather than framework-enforced boundaries.

Migrate the backend to current NestJS while keeping `oidc-provider` as the protocol engine. NestJS will own business modules, dependency injection, validation, request logging, exception handling, lifecycle management, and HTTP composition. `oidc-provider` will remain a native protocol handler mounted through Nest's Express HTTP adapter.

## Goals

- Adopt NestJS 12 with Node.js 24, TypeScript ESM, and the Express platform adapter.
- Organize the backend as a modular monolith with explicit controller, application-service, domain, and repository boundaries.
- Preserve all public URLs, status codes, response bodies, cookies, Redis keys, issuer metadata, signing keys, database schemas, and existing data.
- Add structured request logs for Nest controllers and native OIDC protocol endpoints.
- Keep request and response bodies, credentials, authorization headers, cookies, tokens, codes, and secrets out of logs.
- Preserve the existing React/Vite workspace and same-origin deployment.
- Keep protocol endpoints outside global business-response envelopes and business exception filters.
- Migrate incrementally with characterization tests and an executable rollback point before the final runtime switch.

## Non-goals

- Replacing `oidc-provider` with a custom authorization server.
- Splitting the platform into microservices.
- Changing the React application architecture.
- Changing PostgreSQL schemas solely for the framework migration.
- Replacing `pg`, Redis, Nodemailer, or the current migration runner.
- Changing OIDC grants, claims, token lifetimes, PKCE requirements, client authentication, or subject generation.
- Making the legacy MOONDROP account database writable.
- Copying NestJS 7 dependencies or implementation patterns from `moondrop-service`.

## Constraints

- The repository is ESM (`type: module`) and uses `NodeNext` resolution.
- NestJS packages must stay on one pinned NestJS 12 release line. At design time, NestJS 12 is the current major and supports the selected Node.js runtime.
- The Express adapter is required for the first migration because the existing provider exposes an Express-compatible callback and the current routing behavior is already characterized on Express.
- Nest's default global body parsers must not consume protocol request streams before `oidc-provider` handles endpoints such as `/token`.
- Business controllers may use JSON/form parsing and validation, but parsing must be scoped away from native protocol paths.
- Existing checksum-recorded SQL migrations must not be edited.
- Runtime configuration and signing files remain protected external files selected by environment variables.

## Approaches considered

### 1. Keep Express and reorganize it

Move files into feature folders and add custom dependency injection, logging, validation, and error conventions. This is the lowest-risk option, but all architectural guarantees remain team conventions and it diverges from the backend development model already familiar to the organization.

### 2. NestJS modular monolith with native `oidc-provider` mounting — selected

Use NestJS for business HTTP endpoints and service composition, while mounting `oidc-provider` through the underlying Express adapter. Existing domain and persistence classes are reused first and converted into Nest providers without changing their behavior. This provides module boundaries and observability without rewriting the protocol engine.

### 3. Split protocol and developer platform services

Run OIDC protocol endpoints separately from developer/admin APIs. This produces the strongest runtime boundary but introduces distributed authentication, deployment, monitoring, network-failure, and consistency concerns that are not justified by the current scale.

## Target architecture

```text
src/
├─ main.ts
├─ app.module.ts
├─ bootstrap/
│  ├─ bootstrap.ts
│  └─ shutdown.ts
├─ common/
│  ├─ errors/
│  ├─ filters/
│  ├─ guards/
│  ├─ logging/
│  ├─ middleware/
│  ├─ pipes/
│  └─ tokens/
├─ infrastructure/
│  ├─ config/
│  ├─ database/
│  ├─ redis/
│  ├─ email/
│  └─ web/
└─ modules/
   ├─ health/
   ├─ oidc/
   ├─ account/
   ├─ developer-auth/
   ├─ developer/
   ├─ application/
   └─ admin/
```

Each business module may contain:

```text
<feature>/
├─ <feature>.module.ts
├─ controllers/
├─ application/
├─ domain/
├─ dto/
└─ infrastructure/
```

Small modules do not need every directory. Files are grouped when a boundary exists, not to satisfy an empty-folder template.

## Module responsibilities

### Infrastructure modules

- `ConfigModule`: loads and validates the protected JSON configuration and signing material once; exports immutable typed configuration tokens.
- `DatabaseModule`: owns the OIDC PostgreSQL pool and read-only account PostgreSQL pool, exports distinct injection tokens, and closes both during shutdown.
- `RedisModule`: owns the command and subscriber clients, exports explicit tokens, and closes both during shutdown.
- `EmailModule`: creates the Nodemailer transport only when SMTP is configured and exposes developer code and verification delivery ports.
- `WebModule`: serves `public/app`, static assets, SPA fallbacks, and the public icon without taking ownership of protocol endpoints.

### Business and protocol modules

- `OidcModule`: constructs `oidc-provider`, its adapter factory, account resolver, client repository integration, signing keys, interaction endpoints, audit listeners, and native protocol middleware.
- `AccountModule`: current-user, account, authorization, session, and read-only MOONDROP account operations.
- `DeveloperAuthModule`: email codes, password credentials, developer sessions, registration, login, logout, and MOONDROP binding entry points.
- `DeveloperModule`: profile, qualification submission, status, and developer-owned operations.
- `ApplicationModule`: application and application-group creation, review submission, secret rotation, and client-cache invalidation.
- `AdminModule`: administrator authentication, review queues, decisions, audit queries, and statistics.
- `HealthModule`: liveness and readiness checks.

The React `web/` workspace remains outside Nest modules. It continues to build into `public/app`.

## Layering rules

- Controllers translate HTTP input/output only. They do not query PostgreSQL or Redis directly.
- Application services coordinate use cases and transactions.
- Domain code contains validation and state transitions without depending on Nest or Express.
- Repositories contain SQL and storage mapping. They may use the existing `pg` pool and handwritten SQL.
- Infrastructure adapters implement email, Redis, account-database, encryption, and provider integration ports.
- Cross-module access occurs through exported services or explicit injection tokens, not deep relative imports into another module's internals.
- `oidc-provider` context objects remain inside `OidcModule`; business modules receive narrow interfaces rather than provider internals.

## `oidc-provider` integration

NestJS uses `@nestjs/platform-express`. The provider is constructed by `OidcModule` and mounted as native middleware only for the provider-owned paths exposed by its configuration. Business paths (`/api`, `/interaction`, `/portal`, `/admin`, `/developer`, `/account`, `/health`, `/assets`, and `/app`) remain Nest-owned.

The protocol path predicate must be covered by contract tests for at least:

- `/.well-known/openid-configuration`
- `/auth` or the configured authorization endpoint
- `/token`
- `/userinfo`
- `/revoke`
- `/session/end`
- JWKS discovery

Nest is bootstrapped without global body parsing. JSON and URL-encoded parsers are applied only to Nest-owned business routes. This prevents the provider's POST bodies from being consumed before its callback runs.

Nest global exception filters and response interceptors apply only to Nest controllers. The native provider owns its protocol errors, redirects, cache headers, and response bodies. No `{ code, desc, data }` wrapper is applied to discovery, authorization, token, user-info, revocation, or logout responses.

## HTTP compatibility

A route inventory will capture every current method and path before migration. For each endpoint, tests preserve:

- success status and response body
- error status and error shape
- redirects and `Location`
- cookie name, attributes, path, and lifetime
- origin and CSRF behavior
- authentication and authorization outcome
- protocol content type and cache behavior

Existing business response shapes are retained even when they are not globally uniform. Standardization is a later product change, not part of the framework migration.

## Validation and errors

Nest controllers use DTO/schema validation at their boundary. Because NestJS 12 supports Standard Schema validation, the implementation plan will select one schema library only after checking the locked dependency set; no validation dependency is silently added. Existing domain validation remains authoritative during migration.

Business errors become typed application errors mapped by a global Nest exception filter. PostgreSQL uniqueness conflicts, optimistic-lock conflicts, missing resources, invalid transitions, authentication failures, and dependency outages receive distinct mappings. Unknown internal errors return a request ID but not SQL, stack traces, secrets, or identifiers.

OIDC protocol errors bypass this filter.

## Request logging and observability

A global request-context middleware runs before Nest controllers and the native provider callback. It reuses or generates a bounded request ID and records one structured completion event when the response finishes:

```json
{
  "event": "http_request",
  "requestId": "...",
  "method": "POST",
  "path": "/api/v1/developer-auth/register",
  "status": 200,
  "durationMs": 42,
  "routeKind": "business"
}
```

Logs never contain query strings, bodies, form values, headers, cookies, authorization values, email codes, passwords, client secrets, access tokens, refresh tokens, ID tokens, signing keys, database URLs, or SMTP credentials. OIDC protocol requests log a normalized endpoint name rather than sensitive URL data. Health-check logging may be sampled or disabled in production.

The existing `platform_audit` business/protocol audit trail remains separate from operational request logs.

## Security behavior

- Same-origin mutation checks and double-submit CSRF behavior remain unchanged.
- Developer and administrator cookies preserve their current names and attributes.
- Trusted proxy configuration is applied through the Nest Express instance.
- Security headers are installed globally before static files, Nest routes, and provider middleware.
- Admin routes remain non-discoverable from the public portal; migration does not add public links.
- Account database access remains read-only.
- Secrets remain in protected runtime files or the deployment secret manager.

## Frontend and static hosting

The React workspace, routes, and Vite build remain unchanged. Nest serves the built console and SPA fallbacks with the same paths currently handled by `app.ts`. Local frontend development continues to use Vite and its backend proxy. Independent frontend deployment remains possible later but is not part of this migration.

## Migration strategy

### Phase 0: characterization and inventory

- Record all existing routes and protocol metadata.
- Add compatibility tests for HTTP responses, redirects, cookies, origin checks, CSRF, static files, health endpoints, and OIDC discovery/token behavior.
- Capture current startup and graceful-shutdown behavior.

### Phase 1: Nest foundation and observability

- Add pinned NestJS 12 packages and Express adapter.
- Add `AppModule`, bootstrap, configuration, request context, structured request logging, security headers, and shutdown hooks.
- Keep existing domain and repository classes unchanged and injectable through factory providers.
- Provide a separate Nest development/start command until parity is established; the current entry point remains the rollback path.

### Phase 2: infrastructure and leaf endpoints

- Migrate config, PostgreSQL, Redis, email, health checks, static assets, and SPA fallbacks.
- Verify lifecycle cleanup and readiness behavior.

### Phase 3: business APIs

- Migrate account/session APIs, developer authentication, developer profile/review, applications/groups, then admin APIs.
- Convert one bounded module at a time while reusing tested domain and repository code.
- Preserve route-level behavior through compatibility tests.

### Phase 4: interactions and protocol mounting

- Migrate login, consent, portal, and administrator server-rendered interactions.
- Mount `oidc-provider` through the Express adapter with scoped parsing and protocol logging.
- Run discovery, authorization-code with PKCE, token, user-info, revocation, logout, and multi-instance cache-invalidation tests.

### Phase 5: runtime cutover and cleanup

- Make the Nest bootstrap the default `dev`, `start`, and container entry point only after parity tests pass.
- Keep one release-level rollback tag or branch with the old entry point.
- Remove obsolete Express composition files only after the Nest runtime has passed local, CI, and target-environment acceptance.
- Update operations, deployment, API, and architecture documentation.

## Testing strategy

- Unit tests for domain transitions, application services, repositories, filters, guards, middleware, and logging redaction.
- Controller tests for DTO validation and error mappings.
- HTTP compatibility tests against both the legacy and Nest runtimes during migration.
- OIDC contract tests for discovery and authorization-code + PKCE flows.
- PostgreSQL and Redis integration tests using the existing CI services.
- Tests proving protocol requests bypass Nest response wrapping and global body parsing.
- Tests proving request logs omit credentials, codes, tokens, query strings, cookies, and bodies.
- Frontend tests remain in the existing Vitest workspace.

## Deployment and rollback

No database migration is required merely to switch frameworks. The Nest runtime uses the same protected configuration, signing material, databases, Redis data, and static build.

Before cutover, build both runtimes from the same commit and run compatibility tests. Deploy the Nest runtime as a normal application release. Rollback consists of deploying the previous application image because storage formats and schemas remain compatible. If a later feature adds a schema migration during this work, that migration must have its own forward/rollback assessment and must not be hidden inside the framework cutover.

## Risks and mitigations

- **Body parsing breaks token requests:** disable global parsing, scope parsers to business routes, and test token exchange.
- **Route precedence changes:** maintain a route inventory and test static, SPA, interaction, admin login, API, and provider routes together.
- **Nest filters alter protocol errors:** keep provider responses outside Nest controller filters/interceptors.
- **Cookie or proxy behavior changes:** assert cookie attributes, issuer scheme, forwarded protocol, and trusted proxy behavior.
- **Large rewrite creates regressions:** reuse existing services/repositories first and migrate one bounded module at a time.
- **Duplicate request/audit logs:** keep operational logs and persistent audit events separate and assert one completion log per request.
- **Dependency churn:** pin one NestJS major/minor set in the lockfile and avoid unrelated package upgrades.

## Acceptance criteria

- Backend source is organized by module and layer rather than flat under `src/`.
- Default runtime is NestJS 12 on Node.js 24 with the Express adapter.
- `oidc-provider` remains the protocol implementation and passes the existing protocol flow tests.
- Existing public and internal routes remain compatible.
- Every request produces a safe structured completion log, excluding configured health-check noise.
- Startup and shutdown correctly manage HTTP, PostgreSQL, Redis command/subscriber, Nodemailer, and provider resources.
- Current frontend builds and runs without API changes.
- Full type checking, linting, backend tests, frontend tests, builds, and storage integration tests pass.
- Deployment documentation explains configuration, migrations, logs, health checks, cutover, and rollback.
