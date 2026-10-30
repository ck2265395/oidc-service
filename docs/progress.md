# Development progress

Status date: 2026-10-30 (UTC)

This page records public-safe implementation status. Detailed product requirements are maintained outside this public repository.

## Implemented

- Strict configuration validation, protected key generation, administrator password hashing, request IDs, safe error responses, browser security headers, dependency-aware readiness checks, and GitHub Actions checks.
- Read-only account lookup, legacy password verification, credential-version checks, stable sector-specific subjects, scope-limited claims, and atomic Redis login-identifier/source-IP throttles.
- Revision-checked application drafts, owner-scoped listing and editing, approval snapshots, and transactional review history.
- Web client secrets encrypted with AES-GCM, returned once during creation, and rotated with revision checks. Provider client cache is cleared locally after review and rotation.
- Upstream oidc-provider startup with persistent RS256 signing keys, S256 PKCE, authorization-code grants, and openid/profile/email scopes.
- CSRF-protected login and consent interactions; consent shows the approved application purpose, developer, policy links, and human-readable requested data, plus a user authorization page with grant revocation.
- A bilingual service landing page at `/` and a developer UI at `/developer`, backed by revisioned profile, application, and group APIs for profile maintenance, drafts, review submission, secret rotation, and group requests/renames.
- Administrator group approval, rejection, disablement, group history, and audit updates in one database transaction.
- An independent administrator session with scrypt login, direct-peer-IP throttling, idle and absolute expiry, review queue, approve/reject/disable forms, audit view, and database status statistics.

## Not yet accepted end to end

- No live PostgreSQL or Redis deployment has been connected. Redis rate-limit behavior has unit coverage, while database roles, full protocol persistence, and multi-instance behavior still need live integration tests.
- Cross-instance client-cache invalidation remains incomplete; protocol documents still use PostgreSQL, while atomic replay detection and login throttling now use Redis. Login counters hash resolved account identifiers (or submitted identifiers when lookup is ambiguous) and source addresses resolved through explicitly trusted proxy ranges. Live Redis/proxy integration remains unverified.
- Contact email verification, portal sign-in flow, and full usability/accessibility acceptance for the initial developer UI remain incomplete; approved or disabled application groups cannot be renamed, and groups cannot be deleted.
- The administrator audit currently records application reviews and user grant revocations; other operational events and audit retention cleanup are incomplete.
- Web/native relying-party examples, container packaging, deployment/upgrade guidance, and a complete protocol acceptance matrix remain incomplete.
- This branch is for development. No production readiness or complete OIDC service is claimed.

The detailed internal requirements were not copied to this public repository.