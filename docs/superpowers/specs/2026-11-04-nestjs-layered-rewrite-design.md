# NestJS Layered Rewrite Design

## Intent

The service is still under construction, so remove the remaining hybrid architecture in one coordinated rewrite rather than preserving compatibility wrappers. The finished backend must be a NestJS modular monolith whose domain rules, use cases, infrastructure adapters, HTTP boundaries, and protocol adapters live under their owning module. `src/` must no longer contain the former flat implementation files.

The rewrite is structural. Existing HTTP contracts, OIDC behavior, database schema, Redis key behavior, cookie attributes, security controls, and public TypeScript behavior covered by tests must remain unchanged unless a Nest boundary makes an internal constructor obsolete.

## Goals

- Make each business capability owned by one Nest module.
- Replace factory-heavy module wiring with injectable Nest providers where practical.
- Move pure rules and types into `domain/`, orchestration into `application/`, and PostgreSQL/Redis/SMTP/OIDC adapters into `infrastructure/`.
- Keep Controllers and middleware thin and free of SQL or domain state transitions.
- Leave only `main.ts`, `app.module.ts`, and directories at `src/` root.
- Delete every migrated flat root implementation after all references are redirected.
- Preserve full server, web, storage, and build verification.

## Non-goals

- No API version changes, response-shape changes, database migrations, dependency upgrades, or new dependencies.
- No frontend redesign.
- No replacement of `oidc-provider`.
- No conversion of protocol middleware into ordinary JSON Controllers where doing so would change OIDC semantics.
- No changes to protected runtime configuration formats or secret values.

## Constraints and safety boundaries

- Node.js 24, NestJS 12, Express adapter, `oidc-provider` 9, PostgreSQL, and Redis remain the platform.
- The OIDC discovery, authorization, token, user-info, revocation, logout, interaction, and portal paths must continue to bypass global response envelopes and inappropriate body parsing.
- Existing PostgreSQL table and Redis-key contracts remain authoritative.
- Passwords, codes, cookies, tokens, headers, connection strings, and secrets must never be added to logs.
- Existing unrelated working-tree changes in `runtime/config.example.json`, `src/developer-store.ts`, `src/interactions.ts`, and `test/developer-store.test.ts` must be preserved and reconciled before their files are moved.
- The final rewrite is committed in reviewable domain-sized commits even though the runtime cutover is one coordinated branch change.

## Approaches considered

### Incremental compatibility migration

Move one module at a time while retaining flat re-export or compatibility files. This is safest for a live system, but it would deliberately preserve the hybrid structure the rewrite is meant to eliminate.

### Parallel V2 implementation

Build a second module tree and switch `AppModule` after both implementations coexist. This simplifies rollback but duplicates security-sensitive code and creates two sources of truth.

### One coordinated layered rewrite — selected

Build the final module ownership directly, update all imports and dependency injection in the same branch, then delete the flat files. This has the largest short-term diff but best fits a pre-production project and avoids compatibility scaffolding. Domain-sized commits and continuous tests provide diagnostic checkpoints without shipping a hybrid endpoint.

## Target structure and ownership

```text
src/
├─ app.module.ts
├─ main.ts
├─ common/
│  ├─ domain/                 shared errors and small cross-domain contracts only
│  ├─ security/               cryptography, cookies, CSRF and request-origin helpers
│  ├─ logging/                request context and bounded completion logging
│  ├─ middleware/             global HTTP ordering and security middleware
│  └─ tokens/                 Nest injection tokens
├─ infrastructure/
│  ├─ config/                 configuration schema, validation and ConfigService
│  ├─ database/               pools, lifecycle and shared query contracts
│  ├─ email/                  SMTP transport
│  ├─ keys/                   signing-key lifecycle
│  ├─ redis/                  Redis clients and lifecycle
│  ├─ maintenance/            expired-data query definitions
│  └─ web/                    React static hosting
└─ modules/
   ├─ account/
   │  ├─ domain/              account identity, login identifiers and claims rules
   │  ├─ application/         account/session/authorization use cases and ports
   │  ├─ infrastructure/      read-only account PostgreSQL source and OIDC account repository
   │  └─ controllers/
   ├─ developer-auth/
   │  ├─ domain/              credentials, password policy and email-code rules
   │  ├─ application/         registration and login use cases
   │  ├─ infrastructure/      credential/email-code persistence and Redis limiting
   │  └─ dto/
   ├─ developer/
   │  ├─ domain/              identity, profile and review state machine
   │  ├─ application/         profile, binding, submission and session use cases
   │  ├─ infrastructure/      developer repository and session persistence
   │  └─ controllers/
   ├─ application/
   │  ├─ domain/              application drafts, status transitions and groups
   │  ├─ application/         application/group commands and queries
   │  ├─ infrastructure/      combined PostgreSQL repository and secret encryption adapter
   │  └─ controllers/
   ├─ admin/                  administrator guard, login, audit and review orchestration
   ├─ oidc/
   │  ├─ domain/              provider-facing account/client contracts
   │  ├─ application/         provider construction, audit and cache invalidation orchestration
   │  └─ infrastructure/      oidc-provider adapter, provider factory, interaction and portal routers
   └─ health/
```

The tree is illustrative rather than exhaustive; existing bootstrap, filter, middleware, logging, and web-hosting responsibilities remain explicit directories. Shared code is allowed in `common/` only when at least two modules own no natural home for it. Domain-specific types must not be moved into a generic shared folder merely to avoid imports.

## Dependency direction

- Controllers and protocol adapters call application services.
- Application services depend on domain types and explicit ports.
- Infrastructure providers implement those ports and may depend on external libraries.
- Domain code imports neither NestJS nor infrastructure code.
- Modules may import another module's exported application-facing service or token; they must not import another module's repository implementation.
- `AppModule` composes modules and infrastructure but contains no business construction logic.
- Express `Request` and `Response` types are restricted to Controllers, guards, middleware, and OIDC/HTML protocol adapters. Application services receive narrow identity, cookie, origin, CSRF, and provider-context values through ports.

Nest classes use constructor injection and `@Injectable()` where they are runtime providers. Pure domain functions and immutable value types remain framework-free. Dynamic `register(options)` module entry points may remain for isolated HTTP tests, but production registration must use providers exported by the owning module rather than manually constructing deep object graphs.

## Module API graph

The final production graph must be acyclic at module level:

- `AccountModule` exports account resolution and account-profile/session use cases. It does not import `OidcModule`; the provider-session bridge is an explicit late-bound gateway owned by Account and attached exactly once by OIDC during startup.
- `DeveloperAuthModule` exports credential verification, email-code commands, and the developer-auth session API. It consumes Developer persistence through tokens exported by `DeveloperModule`, without importing concrete repositories.
- `DeveloperModule` is canonical for developer identity, profile, qualification status, external MOONDROP binding, sessions, and contact-email verification. It exports narrow profile/status/session ports used by DeveloperAuth, Application, Admin, and OIDC.
- `ApplicationModule` exports application/group commands, approved-client lookup, and cache invalidation registration. It consumes only the Developer profile/status port.
- `AdminModule` exports a narrow administrator-session query port and administrator review use cases. It consumes Application and Developer application-facing services.
- `AccountModule`'s `/api/v1/session` orchestration consumes the narrow administrator-session query token; it never queries administrator tables itself.
- `OidcModule` consumes Account resolution, Developer profile/status, and Application approved-client lookup. It owns the two explicitly permitted late bindings: attaching the provider-session gateway and registering the Application client-cache invalidator.

No other late attachment or global-provider dependency is allowed. Module tests must prove production provider resolution without relying on accidental `global: true` visibility.

## Symbol-level migration map

- `accounts.ts`: identity/login/claims rules → Account domain; PostgreSQL account source → Account infrastructure; authentication orchestration → Account application.
- `applications.ts`: application draft types and validation → Application domain.
- `platform.ts`: application state transitions and application use cases → Application domain/application; developer profile operations are removed from this service and delegated to Developer.
- `groups.ts`: group types/transitions → Application domain; group orchestration → Application application layer.
- `store.ts`: application/group SQL → Application infrastructure; developer profile/status SQL → Developer infrastructure; pool creation → shared database infrastructure.
- `developer-identity.ts`: developer identity/profile/review rules → Developer domain; password digest rules used only by credentials → DeveloperAuth domain.
- `developer-auth-service.ts` and `developer-email-code.ts`: credential and code rules/use cases → DeveloperAuth domain/application.
- `developer-session.ts`: session rules/use cases → Developer application; persistence operations → Developer infrastructure.
- `developer-store.ts`: split credentials/codes into DeveloperAuth infrastructure; external identities/profiles/reviews/sessions/admin queries into Developer infrastructure. Preserve the existing local fixes and their tests at the new owning paths.
- `adapter.ts`, `provider.ts`, `interactions.ts`, `user-portal.ts`, `login-limiter.ts`: OIDC adapter/provider/rate-limit/protocol responsibilities → OIDC infrastructure/application. Direct SQL and grant transitions in portal/interaction adapters move behind application ports.
- `email-verification.ts`: verification use case → Developer application; Redis code storage → Developer infrastructure; Nodemailer construction remains Email infrastructure.
- `config.ts` → infrastructure config schema and loader.
- `security.ts`: shared token/equality/password/HTML helpers → common security; application client-secret encryption → Application infrastructure.
- `http-security.ts` → common HTTP security.
- `cleanup.ts` → infrastructure maintenance.

## OIDC protocol boundary

`oidc-provider` remains mounted through Nest's Express adapter. The adapter factory, provider factory, interaction router, and user portal router are infrastructure adapters owned by `OidcModule`. They may use Express `Router`, but they are created and injected by Nest providers. This is intentional protocol integration, not a second application runtime.

The provider receives account resolution, developer profile/status lookup, application-client lookup, signing keys, PostgreSQL adapter storage, Redis replay/rate-limit facilities, and audit through explicit injected services or ports. Developer contact-email verification is wired by DeveloperModule and is not an OIDC responsibility. `OidcProviderService` remains the single lifecycle owner that creates the provider, initializes signing keys, subscribes to Redis invalidation, attaches the provider-session gateway, registers client-cache invalidation, and mounts protocol middleware exactly once.

Middleware order is frozen as: request context/security/logging → parsers scoped only to business APIs → interaction and portal routers → protocol audit and `oidc-provider` callback → static SPA fallback. Protocol request bodies must remain unread before `oidc-provider`, and SPA fallback must never intercept protocol routes.

## Configuration, security, and maintenance

Configuration types and `loadConfig` move beside `ConfigService`; scripts and tests import from the new location. Cryptographic and HTTP security helpers move without algorithm or cookie-policy changes. Expired-data SQL moves into maintenance infrastructure and remains consumed by `scripts/clean-expired.ts`.

No transitional barrel file may recreate the flat architecture. Small `index.ts` barrels are allowed only inside a module boundary when they expose a deliberate public API.

## Testing and acceptance

Before implementation moves behavior, characterization tests must cover the known gaps: `POST /api/v1/developer/moondrop/create`, administrator developer list/detail/review (including pagination, reason requirements and conflicts), and authenticated `/api/v1/session` without session-identifier disclosure.

Tests update imports without deleting behavioral coverage. Test files remain under the existing top-level `test/` layout so `npm test` continues to discover them. Every previously active public route retains Nest HTTP coverage. Pure domain tests continue to test state transitions and validation without booting Nest. Repository tests continue to validate SQL contracts. CI must explicitly run `npm run test:web` in addition to the server suite.

Acceptance requires:

- no production or test imports from the deleted flat file locations;
- no flat implementation files at `src/` root;
- `npm run check` and `npm run lint` pass;
- all server and web tests pass;
- production build passes;
- storage integration suite passes when PostgreSQL/Redis are available, otherwise reports only the existing environment skip;
- runtime smoke checks cover health, discovery, anonymous administrator redirect, and OIDC authorization interaction;
- request logs and security behavior remain unchanged.

## Failure and rollback

The branch is not partially deployed. If final acceptance fails, fixes remain on the feature branch or the branch is abandoned; production rollback remains redeployment of the previous tested image with compatible database state. No database migration is introduced by this rewrite.
