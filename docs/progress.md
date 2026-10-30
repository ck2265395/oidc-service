# Development progress

Status date: 2026-10-30 (UTC)

This page records public-safe implementation status. Detailed product requirements are maintained outside this public repository.

## Completed foundation

- Added strict JSON configuration validation, protected key generation, administrator password hashing, request IDs, safe health/error responses, and GitHub Actions checks.
- Added read-only account lookup, legacy password verification, stable sector-specific subjects, credential-version checks, and scope-limited claims.
- Added client registration validation for web, SPA, and native client metadata.
- Added revision-checked application drafts, review states, preserved approved snapshots, owner-scoped queries, and PostgreSQL persistence with review history.
- Added a PostgreSQL oidc-provider adapter for persisted grants, codes, tokens, and sessions, including expiry and replay protection.
- Added provider configuration for upstream oidc-provider, persistent signing keys, RS256, S256 PKCE, authorization-code-only clients, and the supported openid/profile/email scopes.
- Connected provider startup to the OIDC database and read-only account database.

## Current limitations

- Interactive login and consent routes are not implemented; authorization requests cannot yet complete.
- Client-secret creation, encrypted storage, one-time delivery, and rotation are not implemented. The current adapter deliberately does not load confidential web clients.
- Developer and user portals, administrator review UI/API, application-group workflows, account consent revocation, and audit views remain incomplete.
- Redis integration, real PostgreSQL/Redis integration coverage, container packaging, deployment guidance, and end-to-end protocol acceptance remain incomplete.
- The public branch is a development branch. No production readiness or complete OIDC service is claimed.

The detailed internal requirements were not copied to the public repository.
