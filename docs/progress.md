# Development progress

Status date: 2026-10-30 (UTC)

This page records public-safe implementation status. Detailed product requirements are maintained outside this public repository.

## Implemented

- Strict configuration validation, protected key generation, administrator password hashing, request IDs, safe error responses, browser security headers, and GitHub Actions checks.
- Read-only account lookup, legacy password verification, credential-version checks, stable sector-specific subjects, and scope-limited claims.
- Revision-checked application drafts, owner-scoped listing and editing, approval snapshots, and transactional review history.
- Web client secrets encrypted with AES-GCM, returned once during creation, and rotated with revision checks. Provider client cache is cleared locally after review and rotation.
- Upstream oidc-provider startup with persistent RS256 signing keys, S256 PKCE, authorization-code grants, and openid/profile/email scopes.
- CSRF-protected login and consent interactions, plus a user authorization page with grant revocation.
- Revisioned developer profile registration and owner-scoped APIs for application create/list/edit/submit/secret rotation and application-group requests.
- Administrator group approval, rejection, disablement, group history, and audit updates in one database transaction.
- An independent administrator session with scrypt login, direct-peer-IP throttling, idle and absolute expiry, review queue, approve/reject/disable forms, audit view, and database status statistics.

## Not yet accepted end to end

- No live PostgreSQL or Redis deployment has been connected. The GitHub CI suite validates types, lint, existing unit/HTTP tests, and build only.
- Redis-backed cross-instance replay/session state and client-cache invalidation are incomplete. Disablement or key rotation across multiple service instances requires integration work.
- Contact email verification and a complete server-rendered developer portal are incomplete; group names cannot yet be edited or deleted.
- The administrator audit currently records application reviews and user grant revocations; other operational events and audit retention cleanup are incomplete.
- Web/native relying-party examples, container packaging, deployment/upgrade guidance, and a complete protocol acceptance matrix remain incomplete.
- This branch is for development. No production readiness or complete OIDC service is claimed.

The detailed internal requirements were not copied to this public repository.