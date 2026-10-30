# Web client example

This sample is a small server-side relying party. It uses authorization code with S256 PKCE, validates the ID token signature, issuer, audience, and nonce, and keeps the client secret and demo session on the server.

## Register the client

Create a Web application in the developer center and use these exact values:

- Login callback: http://127.0.0.1:4000/callback for a development-mode service; for production use an HTTPS origin you control.
- Logout return: http://127.0.0.1:4000/logout/callback (or the matching HTTPS URL).
- Request openid, profile, and email.
- Fill the required public HTTPS application homepage, privacy policy, and terms URLs, then submit the application. After approval, copy the client ID and secret into the local environment.

## Run locally

Node.js 24 and npm 11 are required. From this directory:

```sh
npm install
OIDC_ISSUER=http://127.0.0.1:3000 OIDC_CLIENT_ID=approved-client-id OIDC_CLIENT_SECRET=client-secret APP_ORIGIN=http://127.0.0.1:4000 npm start
```

Open http://127.0.0.1:4000. Keep the secret in the server environment; never put it in browser code or commit it.

This sample stores login transactions and sessions in memory and is for local integration only. Production relying parties should use a maintained OIDC client library, durable session storage, CSRF protection on state-changing endpoints, secure cookie configuration, and their deployment's secret manager.
