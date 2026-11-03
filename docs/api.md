# API guide

- `GET /health/live` reports process liveness.
- `GET /health/ready` checks the OIDC database, read-only account database, and Redis; it returns `503` when a required dependency is unavailable.
- Login throttling defaults to 10 attempts per resolved account and 100 per trusted source IP within 15 minutes. `loginRateLimit` can tune these values in protected configuration; Redis failures reject login attempts.

The public service landing page is served at `/`. The user portal provides `/portal/profile` and `/portal/authorizations`, the public developer portal and developer console share `/developer/*`, and the administrator sign-in is at `/admin/login`. Static console assets are served under `/app/assets/`. Developer email registration and password login use `/api/v1/developer-auth/*`; MOONDROP login starts at `/developer/login/moondrop` and requires an explicit create-or-bind decision before a developer session is established.

Consumer account APIs require an active MOONDROP OIDC-provider session. Developer APIs require the separate developer session unless explicitly marked public, and administrator APIs require the isolated administrator session. Successful responses use:

```json
{ "code": 0, "desc": "ok", "data": {} }
```

Errors use the same shape with a stable nonzero code and an appropriate HTTP status. Responses include no-store headers.

## Current user profile

- `GET /api/v1/me` requires the current identity-service session and rechecks account status and credential version. It returns only nickname, masked email, and a safe HTTPS picture URL when available; it never returns internal account identifiers. Relative picture paths are omitted unless `profilePictureBaseUrl` is configured.

## Developer authentication and profile

Developer authentication endpoints that do not require an existing developer session are:

- `POST /api/v1/developer-auth/email-code` with `{ "email", "purpose": "register|bind|reset" }`.
- `POST /api/v1/developer-auth/register` with `{ "email", "password", "code" }`.
- `POST /api/v1/developer-auth/login` with `{ "email", "password" }`.
- `GET /api/v1/developer-auth/session` returns the current developer summary and a CSRF token.

The authenticated `POST /api/v1/developer-auth/logout` endpoint requires the developer session, CSRF header and same-origin request.

The developer session cookie is separate from both the MOONDROP end-user OIDC session and the administrator session. Developer sessions have a seven-day sliding lifetime capped by a 30-day absolute expiry. Disabling a developer revokes its active sessions.

First request a CSRF token:

```http
GET /api/v1/developer/csrf
```

Then create or update the developer profile:

```http
PUT /api/v1/developer/profile
Origin: https://identity.example
X-CSRF-Token: <token>
Content-Type: application/json

{
  "expectedRevision": 0,
  "displayName": "Example developer",
  "contactEmail": "dev@example.invalid",
  "contactPhone": "",
  "purpose": "Describe the intended integration"
}
```

Use the returned revision for subsequent profile updates. Submit the completed profile for administrator review before creating applications or groups. Status values are `unsubmitted`, `pending`, `approved`, `rejected`, and `disabled`; only `approved` developers can create resources. Rejected developers can edit and resubmit. Review history and the latest rejection reason are returned to the owning developer.

- `POST /api/v1/developer/review/submit` submits the completed profile and requires `expectedRevision`.
- `GET /api/v1/developer/review/history` returns the authenticated developer's immutable review history.

Public UI routes are `/developer`, `/developer/login`, `/developer/register`, `/developer/bind`, and `/developer/docs`. Routes under `/developer/console/*` are private and resolve the developer session before returning account data.

## Application groups

- `GET /api/v1/developer/groups?page=1&pageSize=20`
- `POST /api/v1/developer/groups` with `{ "displayName": "Example group" }`
- `PUT /api/v1/developer/groups/:id` with `expectedRevision` and `displayName` (only pending or rejected groups can be renamed; the rename returns the group to pending review)
- `DELETE /api/v1/developer/groups/:id` with `expectedRevision` (only pending or rejected groups with no application references can be deleted; successful deletion is audited)

Creating a group requires a registered developer profile. New groups start in pending review. Applications can reference only groups owned by the same account; shared subjects use the group only after approval.

## Applications

- `GET /api/v1/developer/applications?page=1&pageSize=20`
- `POST /api/v1/developer/applications` with `{ "type": "web|spa|native", "draft": { ... } }`
- `GET /api/v1/developer/applications/:id`
- `PATCH /api/v1/developer/applications/:id` with `expectedRevision` and `draft`
- `POST /api/v1/developer/applications/:id/submit` with `expectedRevision`
- `POST /api/v1/developer/applications/:id/rotate-secret` with `expectedRevision`

Mutating requests require the exact configured issuer origin and the CSRF token in the `X-CSRF-Token` header. Web client creation returns a high-entropy client secret once. Store it in the client server’s secret manager; it is never included in the ordinary application response. Rotation invalidates the previous value. Public clients do not receive a secret.

## User and administrator pages

- `GET /portal/authorizations` lists the current user’s nonexpired grants, including scope, status, and authorization time. `GET /portal/authorizations/:id/confirm-revoke` shows the application and requested scope before the user confirms; revocation then uses a CSRF-protected same-origin POST form.
- `GET /admin/login` starts the separate administrator session flow.
- `GET /api/v1/admin/developers?status=pending&page=1&pageSize=20` lists developer reviews; `GET /api/v1/admin/developers/:id` returns the submitted profile and immutable review history.
- `POST /api/v1/admin/developers/:id/review` accepts `approve`, `reject`, `disable`, or `restore` with `expectedRevision`; rejection and disable require a reason.
- `GET /admin/applications` and `GET /admin/groups` show review queues.
- `GET /admin/audit` supports `applicationId`, `from`, `to`, `action`, `outcome`, and `page` filters. Dates use UTC; `to` includes the full day.
- `GET /admin/statistics?days=7&applicationId=...` aggregates protocol request counts, outcomes, and server latency by application and endpoint for 1–90 days, alongside current application status counts.

The administrator session uses its own HTTP-only cookie and separate PostgreSQL session records. Consumer OIDC sessions do not grant administrator access.
