# Development progress

Status date: 2026-10-30 (UTC)

This page records public-safe implementation status. Detailed product requirements are maintained outside this public repository.

## Implemented

- Strict JSON configuration validation, protected key generation, administrator password hashing, request IDs, safe health/error responses, and GitHub Actions checks.
- Read-only account lookup, legacy password verification, stable sector-specific subjects, credential-version checks, and scope-limited claims.
- Client metadata validation for web, SPA, and native application drafts.
- Revision-checked application drafts, review states, preserved approved snapshots, owner-scoped queries, and PostgreSQL persistence with review history.
- A PostgreSQL oidc-provider adapter for persisted protocol documents, expiry, consumption, and replay detection.
- Upstream provider startup with persistent RS256 signing keys, authorization-code clients, S256 PKCE, and the openid/profile/email scope allowlist.
- CSRF-protected login and consent routes using provider interaction APIs and the read-only account service.

## Not yet accepted end to end

- The provider has not been exercised against real PostgreSQL credentials or a running authorization-code client.
- Client secret generation, encrypted storage, one-time delivery, and rotation are incomplete. The adapter currently refuses confidential web clients.
- Developer and user portals, administrator review UI/API, application-group workflows, account consent revocation, and audit views remain incomplete.
- Redis integration, real PostgreSQL/Redis integration coverage, multi-instance replay verification, container packaging, deployment guidance, and Web/native client examples remain incomplete.
- Protocol cache invalidation after application review or disablement has not been wired.
- The public branch is a development branch. No production readiness or complete OIDC service is claimed.

The detailed internal requirements were not copied to this public repository.
