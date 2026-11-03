# NestJS backend architecture

The default backend is a NestJS 12 modular monolith running on Node.js 24 with the Express platform adapter. `src/main.ts` starts `AppModule`; `src/legacy-main.ts` is a temporary one-release rollback entry and must not be used as the normal runtime.

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

For the migration release only, `npm run start:legacy` starts the prior Express composition. Production rollback should deploy the previous tested image/tag rather than mixing old and new processes. Remove the temporary legacy entry after the observation window and a reviewed follow-up release.
