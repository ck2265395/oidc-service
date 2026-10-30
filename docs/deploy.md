# Deployment guide

## Runtime requirements

- Node.js 24 and npm 11, or Docker Engine with the Compose plugin.
- PostgreSQL for OIDC platform data and a separate, existing account database with a read-only login role.
- Redis 7.4 or compatible Redis server. Login throttles, replay detection, portal login transactions, and client-cache invalidation use Redis.
- A stable HTTPS issuer URL, protected configuration and signing-key files, and a reverse proxy that preserves the original host and protocol.

The account database is never migrated or written by this service. Configure its existing schema and a database role that has only the required SELECT privileges.

## Account portal links and profile pictures
\nThe protected `accountPortal` setting may contain `registrationUrl`, `passwordResetUrl`, and `profileUrl`. Each value must be an HTTPS URL in production (HTTP is allowed only outside production), contains no credentials, and is never taken from a request parameter. The sign-in page opens registration and password recovery in a separate tab so the pending sign-in transaction remains available. `profilePictureBaseUrl` is optional; when configured it must be a trusted HTTPS base in production. Relative picture paths from the account database are omitted when no base is configured, and the service never fetches picture URLs server-side.\n\n## SMTP email verification

The developer contact-email verification workflow is enabled only when the protected configuration contains an `smtp` object. The example configuration uses `null`, which leaves email verification unavailable and never marks an address verified.

Configure `host`, `port`, `secure`, and `from`; set `user` and `password` together when the relay requires authentication. Keep the password in the protected runtime configuration or secret manager. With `secure: false`, the transport requires STARTTLS and TLS 1.2 or newer. Verify relay reachability and sender authorization in the target environment before enabling the workflow. Verification messages contain a single-use link that expires after 30 minutes; a same-origin confirmation form consumes it, and requests are limited per account.

## Container deployment

1. Copy `config.example.json` to `runtime/config.json`, set `port` to `3000`, and replace every placeholder with actual protected values. Set the OIDC database URL to `oidc-db` and Redis URL to `redis` for the Compose network. Configure the account database URL using a host reachable from the container.
2. Set `mode` to `production`, configure the public HTTPS `issuer`, and list only actual reverse-proxy CIDRs in `trustedProxyCidrs`.
3. Generate signing material outside the repository with `npm run keys -- --out runtime/signing.json`; provide the other generated keys in the protected configuration. Create an administrator password hash with `npm run admin:password`.
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
- Run `npm run clean:expired` on a schedule from one maintenance job to remove expired OIDC documents, administrator sessions and login limits, plus audit records older than 90 days. The command touches only the OIDC database and deletes in batches of 5,000.
- Back up PostgreSQL and Redis data volumes using the platform’s approved backup process. Signing keys and service secrets require separate encrypted backup and access controls.
- Rotate signing keys with a planned JWKS overlap and client coordination. The current key loader accepts one active RS256 signing key; automated rotation is not implemented.

## Deployment acceptance still required

The repository does not include access to the actual account database, production proxy, secret manager, SMTP relay, or deployment platform. Validate the read-only role, database schema, proxy trust boundaries, Redis durability/availability, issuer discovery, client flows, backup/restore, and rolling multi-instance behavior in the target environment before production use. This repository's CI runs unit and HTTP checks; it does not claim a live production-like PostgreSQL and Redis acceptance run.
