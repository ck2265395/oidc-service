# Environment configuration layout design

## Intent

Make local, test, and production configuration boundaries explicit without changing the service's protected JSON configuration model or exposing secrets through Git.

## Chosen approach

- Local development uses ignored `runtime/config.local.json` and `runtime/signing.local.json` files selected by `.env.local`.
- The repository contains only `runtime/config.example.json`; developers copy it to the ignored local filename and replace placeholders.
- Test and production deployments provide protected JSON and signing files outside the repository, then set `OIDC_CONFIG_FILE` and `OIDC_SIGNING_KEY_FILE` to their mounted absolute paths.
- Existing configuration validation and runtime behavior remain unchanged.

## Alternatives considered

- Flatten every JSON property into environment variables: rejected because nested databases, SMTP, secrets, account portal, and throttling settings become harder to validate and operate.
- Commit separate local/test/production JSON files: rejected because it encourages committing credentials and duplicates environment-specific secrets.

## Safety constraints

- Preserve the current local configuration contents during rename.
- Never read, print, or commit `.env.local`, runtime configuration, signing material, or passwords.
- Keep `runtime/` ignored except for the non-secret example template.
