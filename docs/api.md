# API guide

- `GET /health/live` reports process liveness.
- `GET /health/ready` checks the OIDC database, read-only account database, and Redis; it returns `503` when a required dependency is unavailable.
- Login throttling defaults to 10 attempts per resolved account and 100 per trusted source IP within 15 minutes. `loginRateLimit` can tune these values in protected configuration; Redis failures reject login attempts.

The bilingual service landing page is served at `/`. It links to user authorizations, the developer portal, and the administrator sign-in. The developer portal is served at `/developer` with static assets under `/assets/`. `/developer/login` starts the first-party portal sign-in using authorization code + S256 PKCE; `/portal/sign-in` and `/portal/callback` hold a short-lived, single-use Redis login transaction and verify the returned ID token. The developer portal uses the same owner-scoped APIs documented below; an active identity-service session is required.

All application APIs require an active OIDC provider session. Successful responses use:

```json
{ "code": 0, "desc": "ok", "data": {} }
```

Errors use the same shape with a stable nonzero code and an appropriate HTTP status. Responses include no-store headers.

## Developer profile

First request a CSRF token:

```http
GET /api/v1/developer/csrf
```

Then register the developer profile:

```http
PUT /api/v1/developer/profile
Origin: https://identity.example
X-CSRF-Token: <token>
Content-Type: application/json

{
  "expectedRevision": 0,
  "displayName": "Example developer",
  "contactEmail": "dev@example.invalid"
}
```

Use the returned revision for subsequent profile updates. To request verification, call `POST /api/v1/developer/profile/verification-email` with the same origin and CSRF headers. A one-time link expires after 30 minutes and opens a confirmation page at `GET /api/v1/developer/verify-email?token=...`; the user confirms with a same-origin POST to the same path. This avoids consuming links when mail security scanners only open them. Resends are limited to one per account every five minutes. The address is marked verified only if it still matches the profile at confirmation time. SMTP must be configured; otherwise the request returns `503` and the profile remains unverified.

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

- `GET /portal/authorizations` lists the current user’s nonexpired grants. Revocation uses a CSRF-protected same-origin form.
- `GET /admin/login` starts the separate administrator session flow.
- `GET /admin/applications` and `GET /admin/groups` show review queues.
- `GET /admin/audit` supports `applicationId`, `from`, `to`, `action`, `outcome`, and `page` filters. Dates use UTC; `to` includes the full day.
- `GET /admin/statistics?days=7&applicationId=...` aggregates protocol request counts, outcomes, and server latency by application and endpoint for 1–90 days, alongside current application status counts.

The administrator session uses its own HTTP-only cookie and separate PostgreSQL session records. Consumer OIDC sessions do not grant administrator access.
