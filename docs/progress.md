# Development progress

Status date: 2026-10-30 (UTC)

This page records public-safe implementation status. Detailed product requirements are maintained outside this public repository.

## Implemented

- Strict configuration validation, protected key generation, administrator password hashing, request IDs, safe error responses, browser security headers, dependency-aware readiness checks, and GitHub Actions checks.
- Read-only account lookup, legacy password verification, credential-version checks, stable sector-specific subjects, scope-limited claims, and atomic Redis login-identifier/source-IP throttles.
- Revision-checked application drafts, owner-scoped listing and editing, approval snapshots, and transactional review history.
- Web client secrets encrypted with AES-GCM, returned once during creation, and rotated with revision checks. Provider client cache is cleared locally and Redis pub/sub broadcasts review, disablement, and secret-rotation invalidations across running instances.
- Upstream oidc-provider startup with persistent RS256 signing keys, S256 PKCE, authorization-code grants, and openid/profile/email scopes.
- CSRF-protected login and consent interactions; the first-party user portal signs in with authorization code + S256 PKCE, one-time Redis state and nonce, and verified ID tokens; consent shows the approved application purpose, developer, policy links, and human-readable requested data, plus a user authorization page with grant revocation.
- A bilingual service landing page at `/`, user profile and authorization pages, and a developer UI at `/developer`. The authenticated `GET /api/v1/me` endpoint returns only the current user's nickname, masked email, and a safe picture URL when configured. Registration, password recovery, and profile management links use trusted protected configuration. Developer APIs provide revisioned profile, application, group, and credential operations.
- Administrator group approval, rejection, disablement, group history, and audit updates in one database transaction.
- An independent administrator session with scrypt login, direct-peer-IP throttling, idle and absolute expiry, review queue, approve/reject/disable forms, audit view, and database status statistics.

## Not yet accepted end to end

- GitHub Actions runs storage integration checks against ephemeral PostgreSQL 17 and Redis 7 services, covering profile/application/group persistence, review state, cross-connection account throttling, and replay detection. The production account database, target network, and full multi-instance deployment have not been connected or accepted.
- Protocol documents still use PostgreSQL; Redis pub/sub now distributes client-cache invalidations, and atomic replay detection, login throttling, and portal login transactions use Redis. Login counters hash resolved account identifiers (or submitted identifiers when lookup is ambiguous) and source addresses resolved through explicitly trusted proxy ranges. Target Redis/proxy integration, missed-notification recovery, and behavior during subscriber disconnects remain unverified.
- Developer contact-email verification is implemented with optional SMTP delivery, single-use Redis tokens, expiration, resend throttling, and an address-match check. Target relay delivery and full usability/accessibility acceptance for the developer UI remain pending; approved or disabled application groups cannot be renamed. Pending or rejected groups can be deleted only when no application references them.
- The administrator audit records application reviews, user grant revocations, and protocol HTTP outcomes without token or credential values. The admin page filters audit records by application, date, action, and outcome; protocol statistics aggregate request volume and latency in the database. A bounded cleanup command retains protocol/audit events for 90 days.
- Runnable Web and Native relying-party examples, a Dockerfile, and a Compose stack for the service, PostgreSQL, and Redis are provided; the existing account database remains an external read-only dependency. Checksum-verified transactional schema migrations are provided. Real-device testing of the examples, target-environment acceptance, and a complete protocol acceptance matrix remain incomplete.
- This branch is for development. No production readiness or complete OIDC service is claimed.

The detailed internal requirements were not copied to this public repository.