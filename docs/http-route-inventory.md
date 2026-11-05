# HTTP route inventory

This inventory freezes route ownership before the NestJS migration. Methods and public paths must remain compatible until an explicitly reviewed API change replaces them.

## Service and frontend

| Method | Path | Owner |
|---|---|---|
| GET | `/` | React console shell |
| GET | `/health/live` | service liveness |
| GET | `/health/ready` | dependency readiness |
| GET | `/assets/*` | public static files |
| GET | `/app/*` | compiled React assets |
| GET | `/developer/login/moondrop` | MOONDROP login redirect |
| GET | `/developer` | developer redirect |
| GET | `/account` | account redirect |
| GET | `/developer/*`, `/account/*`, `/admin/*` except `/admin/login` | React console shell |

## Developer authentication

| Method | Path |
|---|---|
| POST | `/api/v1/developer-auth/email-code` |
| POST | `/api/v1/developer-auth/register` |
| POST | `/api/v1/developer-auth/login` |
| GET | `/api/v1/developer-auth/session` |
| POST | `/api/v1/developer-auth/logout` |

## Developer platform

| Methods | Paths |
|---|---|
| GET | `/api/v1/developer/csrf`, `/profile`, `/moondrop/status`, `/review/history`, `/verify-email`, `/groups`, `/applications`, `/applications/:id` |
| POST | `/api/v1/developer/moondrop/create`, `/moondrop/bind`, `/review/submit`, `/profile/verification-email`, `/verify-email`, `/groups`, `/applications`, `/applications/:id/submit`, `/applications/:id/rotate-secret` |
| PUT | `/api/v1/developer/profile`, `/groups/:id` |
| PATCH | `/api/v1/developer/applications/:id` |
| DELETE | `/api/v1/developer/groups/:id` |

## Account and session

| Method | Path |
|---|---|
| GET | `/api/v1/me`, `/api/v1/session`, `/api/v1/account/authorizations` |
| DELETE | `/api/v1/account/authorizations/:id` |

## Administrator

The server-rendered administrator routes remain under `/admin`; JSON console APIs remain under `/api/v1/admin`.

| Methods | Paths |
|---|---|
| GET, POST | `/admin/login` |
| POST | `/admin/logout` |
| GET | `/admin`, `/admin/applications`, `/admin/applications/:id`, `/admin/groups`, `/admin/groups/:id`, `/admin/audit`, `/admin/statistics` |
| POST | `/admin/applications/:id/review`, `/admin/groups/:id/review` |
| POST | `/api/v1/admin/logout` |
| GET | `/api/v1/admin/overview`, `/developers`, `/developers/:id`, `/applications`, `/applications/:id`, `/groups`, `/groups/:id`, `/audit`, `/statistics` |
| POST | `/api/v1/admin/developers/:id/review`, `/applications/:id/review`, `/groups/:id/review` |

## Portal and interactions

| Method | Path |
|---|---|
| GET | `/portal/sign-in`, `/callback`, `/`, `/profile`, `/authorizations`, `/authorizations/:id/confirm-revoke` |
| POST | `/portal/authorizations/:id/revoke` |
| GET | `/interaction/:uid` |
| POST | `/interaction/:uid/login`, `/interaction/:uid/consent` |

## Native OIDC protocol

`oidc-provider` owns discovery, JWKS, authorization, token, user-info, revocation, and RP-initiated logout endpoints. These responses are never wrapped in the business JSON envelope and must receive unread protocol request bodies.
