# Environment Configuration Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate local, test, and production configuration paths while preserving protected JSON configuration and keeping secrets out of Git.

**Architecture:** `.env.local` selects ignored local runtime files. Test and production inject paths to externally mounted protected files. A committed example JSON documents the complete non-secret schema.

**Tech Stack:** Node.js environment files, JSON runtime configuration, Git ignore rules.

**Spec:** `docs/superpowers/specs/2026-11-03-environment-config-layout-design.md`

## Global Constraints

- Do not read or commit `.env.local` or protected runtime files.
- Do not change configuration parsing or add dependencies.
- Preserve existing local configuration and signing contents.

## Review Focus

- `npm run dev` must resolve the renamed local files.
- The example template must remain tracked while all real runtime files stay ignored.
- Deployment documentation must distinguish local relative paths from externally mounted test/production paths.

---

### Task 1: Environment-specific configuration layout

**Files:**
- Rename: `runtime/config.json` to `runtime/config.local.json` (ignored local file)
- Rename: `runtime/signing.json` to `runtime/signing.local.json` (ignored local file)
- Modify: `.env.local` (ignored local file)
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `runtime/config.example.json`
- Modify: `README.md`
- Modify: `docs/deploy.md`

**Interfaces:**
- Consumes: `OIDC_CONFIG_FILE` and `OIDC_SIGNING_KEY_FILE` environment variables.
- Produces: explicit local paths and documented external test/production path injection.

- [ ] Rename local files without changing their contents.
- [ ] Update local and example environment selectors.
- [ ] Add the tracked non-secret configuration template and ignore exception.
- [ ] Update setup and deployment documentation.
- [ ] Verify ignore behavior, configuration validation, TypeScript checks, and whitespace.
