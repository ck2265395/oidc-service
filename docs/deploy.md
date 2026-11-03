# Deployment guide

## Runtime requirements

- Node.js 24 and npm 11, or Docker Engine with the Compose plugin.
- PostgreSQL for OIDC platform data and a separate, existing account database with a read-only login role.
- Redis 7.4 or compatible Redis server. Login throttles, replay detection, portal login transactions, and client-cache invalidation use Redis.
- A stable HTTPS issuer URL, protected configuration and signing-key files, and a reverse proxy that preserves the original host and protocol.

The account database is never migrated or written by this service. Configure its existing schema and a database role that has only the required SELECT privileges.

## Account portal links and profile pictures

The protected `accountPortal` setting may contain `registrationUrl`, `passwordResetUrl`, and `profileUrl`. Each value must be an HTTPS URL in production (HTTP is allowed only outside production), contains no credentials, and is never taken from a request parameter. The sign-in page opens registration and password recovery in a separate tab so the pending sign-in transaction remains available. `profilePictureBaseUrl` is optional; when configured it must be a trusted HTTPS base in production. Relative picture paths from the account database are omitted when no base is configured, and the service never fetches picture URLs server-side.

## SMTP email verification

The developer contact-email verification workflow is enabled only when the protected configuration contains an `smtp` object. The example configuration uses `null`, which leaves email verification unavailable and never marks an address verified.

Configure `host`, `port`, `secure`, and `from`; set `user` and `password` together when the relay requires authentication. Keep the password in the protected runtime configuration or secret manager. With `secure: false`, the transport requires STARTTLS and TLS 1.2 or newer. Verify relay reachability and sender authorization in the target environment before enabling the workflow. Verification messages contain a single-use link that expires after 30 minutes; a same-origin confirmation form consumes it, and requests are limited per account.

Developer account registration also sends a six-digit code through the same SMTP relay. Codes are valid for 10 minutes and stored in Redis only as HMAC-derived keys. The HMAC uses the protected `secrets.fingerprint` value; it must be an independently generated high-entropy secret, must be identical on every service instance, and must never appear in logs or frontend configuration. Changing it invalidates outstanding registration codes but does not affect registered accounts.

## Environment-specific configuration

The service intentionally keeps structured protected settings in JSON and uses environment variables only to select the files. For local development, copy `runtime/config.example.json` to the ignored `runtime/config.local.json`, generate `runtime/signing.local.json`, and use the paths in `.env.local`:

```dotenv
OIDC_CONFIG_FILE=./runtime/config.local.json
OIDC_SIGNING_KEY_FILE=./runtime/signing.local.json
```

Test and production environments must not reuse or deploy these local files. Mount an environment-specific protected configuration and signing file through the deployment platform or secret manager, then set `OIDC_CONFIG_FILE` and `OIDC_SIGNING_KEY_FILE` to their absolute mounted paths. Keep database credentials, Redis credentials, SMTP passwords, administrator hashes, service secrets, and signing keys outside the image and repository.

After building locally, run `npm run migrate:local` so the migration process loads `.env.local`. The plain `npm run migrate` intentionally does not load a local environment file; test and production deployments must inject their environment variables before invoking it.

## Migration 003: developer identities

Back up the OIDC PostgreSQL database before applying `003_developer_identity.sql`. Stop writes to developer profiles, application groups and applications during the migration window. The account database is read-only and is not modified.

Record these values before migration:

```sql
SELECT count(*) AS developer_profiles FROM developer_profile;
SELECT count(*) AS applications FROM oidc_application;
SELECT count(*) AS application_groups FROM application_group;
SELECT count(DISTINCT owner) AS legacy_owners
FROM (
  SELECT account_uuid AS owner FROM developer_profile
  UNION SELECT owner_account_uuid FROM oidc_application
  UNION SELECT owner_account_uuid FROM application_group
) owners
WHERE owner IS NOT NULL;
```

Build first, then run the checksum-protected migration runner exactly once per release. It uses a PostgreSQL advisory lock, executes each migration in a transaction and safely skips a migration whose recorded checksum is unchanged:

```sh
npm run build
npm run migrate
```

After migration, verify that resource counts did not change and that every profile and owner maps to a developer account:

```sql
SELECT count(*) AS developer_profiles FROM developer_profile;
SELECT count(*) AS applications FROM oidc_application;
SELECT count(*) AS application_groups FROM application_group;

SELECT count(*) AS profiles_without_developer
FROM developer_profile p
LEFT JOIN developer_account d ON d.id = p.developer_id
WHERE p.developer_id IS NULL OR d.id IS NULL;

SELECT count(*) AS applications_without_developer
FROM oidc_application a
LEFT JOIN developer_account d ON d.id::text = a.owner_account_uuid
WHERE d.id IS NULL;

SELECT count(*) AS groups_without_developer
FROM application_group g
LEFT JOIN developer_account d ON d.id::text = g.owner_account_uuid
WHERE d.id IS NULL;

SELECT count(*) AS moondrop_bindings_without_developer
FROM developer_external_identity e
LEFT JOIN developer_account d ON d.id = e.developer_id
WHERE e.provider = 'moondrop' AND d.id IS NULL;

SELECT count(DISTINCT subject) AS migrated_legacy_owners
FROM developer_external_identity
WHERE provider = 'moondrop';
```

All four unmapped counts must be zero, and `migrated_legacy_owners` must equal the preflight `legacy_owners` value. Preserve the preflight output with the release record so the comparison does not depend on rewritten owner columns. Run `npm run migrate` a second time and confirm it reports the database is up to date without changing the recorded counts. Migration 003 preserves legacy MOONDROP subjects in `developer_external_identity` and migrates existing owners as approved developers.

There is no automatic down migration. Before the new service accepts developer registrations or ownership changes, rollback means restoring the pre-migration database backup and deploying the previous service version together. After new developer data has been written, do not attempt a partial schema rollback; restore in a controlled maintenance window or write and review a forward repair migration.


## Software inventory

Run `npm run sbom` after installing dependencies to generate `sbom.cdx.json` in CycloneDX format for production dependencies. CI also attaches this file as a 90-day workflow artifact. The SBOM is generated from the locked dependency tree and should be retained with each release or deployment record.

## Container deployment

1. Copy `runtime/config.example.json` to a protected deployment path such as `/run/secrets/oidc/config.json`, set `port` to `3000`, and replace every placeholder with actual protected values. Set the OIDC database URL to `oidc-db` and Redis URL to `redis` for the Compose network. Configure the account database URL using a host reachable from the container.
2. Set `mode` to `production`, configure the public HTTPS `issuer`, and list only actual reverse-proxy CIDRs in `trustedProxyCidrs`.
3. Generate signing material outside the repository with `npm run keys -- --out /run/secrets/oidc/signing.json`; provide the other generated keys in the protected configuration. Create an administrator password hash with `npm run admin:password`, and set `OIDC_CONFIG_FILE` and `OIDC_SIGNING_KEY_FILE` to the two mounted paths.
4. Set `OIDC_DB_PASSWORD` to the same strong password configured in the OIDC database URL and Compose environment. Keep `runtime/` out of version control.
5. Start PostgreSQL and Redis, then build and start the service:

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f identity
```

The Compose PostgreSQL initialization runs `sql/postgre.sql` only when the data volume is first created. Before the identity service starts, its migration command applies unapplied files in `sql/migrations/` under a PostgreSQL advisory lock. Each migration runs in a transaction and is recorded with a SHA-256 checksum; changing an already applied migration stops startup. For manual deployments, run `npm run build && npm run migrate` before `npm start`. Back up the database and review each new migration before deployment; do not delete a volume to force initialization.

## Health and operations

- `GET /health/live` reports process liveness.
- `GET /health/ready` checks PostgreSQL, the account database, and Redis.
- Terminate with SIGTERM; the service closes HTTP, PostgreSQL, and Redis connections.
- Run `npm run clean:expired` on a schedule from one maintenance job to remove expired OIDC documents, administrator sessions and login limits, developer sessions retained for seven days after their absolute or sliding expiry, developer sessions revoked for at least seven days, plus audit records older than 90 days. Redis registration-code and rate-limit keys expire through Redis TTL and are not scanned. The command touches only the OIDC database and deletes in batches of 5,000.
- Back up PostgreSQL and Redis data volumes using the platform’s approved backup process. Signing keys and service secrets require separate encrypted backup and access controls.
- Rotate signing keys with a planned JWKS overlap and client coordination. The current key loader accepts one active RS256 signing key; automated rotation is not implemented.

## Deployment acceptance still required

The repository does not include access to the actual account database, production proxy, secret manager, SMTP relay, or deployment platform. Validate the read-only role, database schema, proxy trust boundaries, Redis durability/availability, issuer discovery, client flows, backup/restore, and rolling multi-instance behavior in the target environment before production use. This repository's CI runs unit and HTTP checks; it does not claim a live production-like PostgreSQL and Redis acceptance run.
