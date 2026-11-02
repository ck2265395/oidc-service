# Unified console architecture

The identity platform uses a logically separated frontend and backend while keeping a same-origin deployment by default.

## Runtime boundary

- `web/` is an independent React, TypeScript and Vite workspace.
- Vite emits immutable frontend assets into `public/app/`.
- Express serves the compiled shell for `/`, `/account/*`, `/developer/*` and `/admin/*`.
- Business data is available only through `/api/v1/account/*`, `/api/v1/developer/*` and `/api/v1/admin/*`.
- OIDC login and consent remain server-rendered protocol interactions. This keeps passwords, interaction identifiers and consent submission outside the SPA state model.
- Administrator login remains a server endpoint at `/admin/login`; the authenticated workspace is the React console.

This is deliberate frontend/backend separation. A second deployment is not required today: same-origin hosting avoids unnecessary CORS, cookie and CSRF complexity. If traffic or release cadence later requires independent hosting, `web/` can be built and published separately while the API and protocol service stay clustered behind the identity origin or an API gateway.

## Local development

Use two terminals when changing the console:

```sh
npm run dev
npm run dev:web
```

The Vite development server is for frontend iteration. A production-like local run uses:

```sh
npm run build
npm run dev
```

The backend then serves the compiled console from `public/app/`.

## Production build

`npm run build` compiles both the server and the web workspace. The Docker build copies the workspace manifest before `npm ci`, builds both targets, and copies `dist/` plus `public/` into the runtime image. The runtime does not require Vite or TypeScript.

## Security boundary

- User and developer identity comes from the signed OIDC provider session.
- Administrator identity comes from the short-lived sliding administrator session.
- Console mutations use same-origin checks and double-submit CSRF tokens.
- Account authorization revocation verifies ownership again before destroying a grant.
- Client secrets are returned only on creation or explicit rotation and must never be stored in browser persistence.
