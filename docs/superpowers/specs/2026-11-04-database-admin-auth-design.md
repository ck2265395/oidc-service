# Database-backed administrator authentication

## Intent

Move administrator credentials from protected JSON configuration into PostgreSQL so the platform can support real administrator accounts. Preserve convenient local startup by creating `admin / 123456` only when running in local development and the administrator table is empty.

## Scope

- Add a `platform_admin` table containing administrator identity, username, scrypt password hash, status, first-login password-change flag, and timestamps.
- Associate `admin_session` rows with an administrator ID and resolve the current administrator through the session join.
- Authenticate `/admin/login` against the database rather than `config.admin.username/passwordHash`.
- In local development only, initialize `admin / 123456` with a random-salt scrypt hash when no administrator exists.
- Return the authenticated database username from the console session endpoint and use its stable administrator ID for review/audit actors.
- Remove the administrator credential hash from runtime configuration. Keep no plaintext or default hash in tracked configuration.
- Update the full schema, an additive migration, configuration examples, and tests.

## Non-goals

- No administrator-management UI in this change.
- No password reset or password-change page yet. `must_change_password` is persisted for the next administrator-account feature but does not block local use.
- No default administrator is created in test or production modes.

Production administrators are provisioned explicitly through a protected CLI command that prompts for the username and password and writes only the password hash to PostgreSQL.

## Approaches considered

1. Database table with local-only startup seed — selected because it combines local convenience with production safety.
2. Seed `admin / 123456` directly in SQL — rejected because the SQL could be applied to production accidentally.
3. Manual initialization command — rejected for now because it adds friction whenever the local database is recreated.

## Security and failure behavior

- Passwords remain one-way scrypt hashes; login responses do not reveal whether the username exists.
- Existing IP-based login throttling and CSRF/origin checks remain unchanged.
- Bootstrap is idempotent and uses a transaction/advisory lock or conflict-safe insert so clustered startup cannot create duplicates.
- Database/bootstrap failures fail startup or login closed; they never fall back to configuration credentials.
- The weak local password is gated by the parsed runtime mode, not by hostname or request data.

## Verification

- Unit/integration coverage for database credential lookup, disabled administrators, session principal resolution, and idempotent local bootstrap.
- Configuration tests prove administrator hashes are no longer required or tracked.
- Existing login-origin, Nest API, TypeScript, ESLint, web tests, and production builds remain green.
