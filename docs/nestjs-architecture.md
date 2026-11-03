# NestJS backend architecture

The backend is a NestJS 12 modular monolith running on Node.js 24 with the Express platform adapter. `src/main.ts` is the only server entry point and starts `AppModule`.

## Module ownership

- `infrastructure/config`, `database`, `redis`, `email`, and `keys` own protected configuration and external-resource lifecycle.
- `modules/account` owns MOONDROP account profile, session, and authorization APIs.
- `modules/developer-auth` and `modules/developer` own the isolated developer identity, email registration, profile, verification, and review workflow.
- `modules/application` owns developer applications and groups.
- `modules/admin` owns administrator JSON APIs and the direct-access administrator login/review pages.
- `modules/oidc` constructs `oidc-provider`, mounts native protocol middleware, and wires interaction, portal, audit, and cache invalidation behavior.
- `modules/health` and `infrastructure/web` own probes and same-origin React hosting.

`oidc-provider` remains the protocol engine. Discovery, JWKS, authorization, token, user-info, revocation, and logout paths bypass Nest body parsing and response envelopes. JSON and URL-encoded parsing is scoped to `/api`; the token endpoint therefore receives its original form body.

## Request and lifecycle behavior

Each completed request logs only `event`, `requestId`, `method`, normalized `path`, `routeKind`, `statusCode`, `durationMs`, and source IP. Logs never contain query strings, bodies, headers, cookies, credentials, email codes, authorization values, tokens, secrets, database URLs, or SMTP configuration.

Nest shutdown hooks close both PostgreSQL pools, both Redis clients, and the mail transport idempotently. All authentication and review state is stored in PostgreSQL, Redis, or signed provider cookies, so multiple Node/PM2 cluster instances can run behind one identity origin. Sticky sessions are not required; every instance must use identical protected configuration and signing keys.

## Frontend boundary

`web/` remains an independent React/Vite workspace. `npm run build` emits its assets to `public/app/`, which the Nest runtime serves same-origin. It may later be deployed separately, but doing so requires an explicit CORS, cookie, CSRF, and gateway design review.

## Rollback boundary

Rollback means redeploying the previous tested image or tag with compatible database state. Do not run different application versions concurrently behind the same issuer unless that combination has been explicitly validated.
