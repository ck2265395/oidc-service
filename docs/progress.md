# Development progress

Status date: 2026-10-30 (Asia/Shanghai)

This repository started with only a short README and a license file. The source tree described in the project handoff was not present on the connected GitHub branch, so implementation is proceeding from a clean foundation. This page contains only public-safe progress notes; the full product requirements remain outside the public repository.

## Current milestone

### T01 — service foundation

- Added strict JSON configuration parsing and validation for issuer, secrets, administrator credentials, PostgreSQL URLs, Redis URL, and port.
- Added an injectable Express application with a non-caching liveness endpoint, request IDs, a generic not-found response, and sanitized error responses.
- Added startup configuration loading, strict TypeScript settings, ESLint configuration, sample configuration, and an initial GitHub Actions workflow.
- Added configuration and HTTP behavior tests.
- Not yet verified: dependency lockfile, remote CI execution, full OIDC flow, real database/Redis access, container build, and application integration examples.

### Remaining milestones

Protocol, account lookup, application onboarding and review, user portal, administrator portal, storage integration, client examples, operations, and acceptance verification remain in progress. No production readiness or completed OIDC integration is claimed.
