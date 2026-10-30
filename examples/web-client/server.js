import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = required('OIDC_ISSUER').replace(/\/$/, '');
const clientId = required('OIDC_CLIENT_ID');
const clientSecret = required('OIDC_CLIENT_SECRET');
const appOrigin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:4000').origin;
const redirectUri = new URL('/callback', appOrigin).toString();
const port = Number(process.env.PORT || 4000);
const secure = appOrigin.startsWith('https:');
const cookieName = secure ? '__Host-oidc-demo' : 'oidc-demo';
const pending = new Map();
const sessions = new Map();
let metadata;
let jwks;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' is required');
  return value;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
function randomValue(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
function readCookie(request, name) {
  for (const pair of (request.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return null;
}
function setSessionCookie(response, value, maxAge) {
  response.setHeader('Set-Cookie', cookieName + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : ''));
}
function page(title, body) {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + escapeHtml(title) + '</title><main style="font:16px system-ui;max-width:42rem;margin:8vh auto;padding:1rem">' +
    '<h1>' + escapeHtml(title) + '</h1>' + body + '</main></html>';
}
async function discover() {
  if (metadata) return metadata;
  const response = await fetch(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('OIDC discovery failed');
  metadata = await response.json();
  if (metadata.issuer !== issuer || !metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
    throw new Error('OIDC discovery document is invalid');
  }
  jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  return metadata;
}
async function handle(request, response) {
  const url = new URL(request.url, appOrigin);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (url.pathname === '/' && request.method === 'GET') {
    const id = readCookie(request, cookieName);
    const session = id ? sessions.get(id) : null;
    const body = session && session.expiresAt > Date.now()
      ? '<p>Signed in.</p><p><a href="/profile">View verified profile</a></p><p><a href="/logout">Sign out locally</a></p>'
      : '<p>This sample uses OIDC authorization code with PKCE and a confidential server client.</p><p><a href="/login">Sign in</a></p>';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('DT Identity Web Client', body));
    return;
  }
  if (url.pathname === '/login' && request.method === 'GET') {
    const state = randomValue();
    const transaction = { verifier: randomValue(48), nonce: randomValue(), expiresAt: Date.now() + 600000 };
    pending.set(state, transaction);
    const challenge = createHash('sha256').update(transaction.verifier).digest('base64url');
    const oidc = await discover();
    const authorize = new URL(oidc.authorization_endpoint);
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid profile email');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('nonce', transaction.nonce);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    response.writeHead(303, { Location: authorize.toString() }).end();
    return;
  }
  if (url.pathname === '/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const transaction = pending.get(state);
    pending.delete(state);
    if (!transaction || transaction.expiresAt < Date.now() || !code || code.length > 4096) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Sign-in failed', '<p>The sign-in transaction expired. <a href="/login">Try again</a>.</p>'));
      return;
    }
    const oidc = await discover();
    const basic = Buffer.from(encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret)).toString('base64');
    const tokenResponse = await fetch(oidc.token_endpoint, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: transaction.verifier }),
      signal: AbortSignal.timeout(5000),
    });
    if (!tokenResponse.ok) throw new Error('Authorization code exchange failed');
    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== 'string') throw new Error('ID token is missing');
    const verified = await jwtVerify(tokens.id_token, jwks, { issuer, audience: clientId });
    if (verified.payload.nonce !== transaction.nonce || typeof verified.payload.sub !== 'string') {
      throw new Error('ID token nonce or subject is invalid');
    }
    const id = randomValue();
    sessions.set(id, { claims: verified.payload, expiresAt: Date.now() + 3600000 });
    setSessionCookie(response, id, 3600);
    response.writeHead(303, { Location: '/' }).end();
    return;
  }
  if (url.pathname === '/profile' && request.method === 'GET') {
    const id = readCookie(request, cookieName);
    const session = id ? sessions.get(id) : null;
    if (!session || session.expiresAt <= Date.now()) {
      if (id) sessions.delete(id);
      setSessionCookie(response, '', 0);
      response.writeHead(303, { Location: '/login' }).end();
      return;
    }
    const claims = session.claims;
    const safeClaims = Object.fromEntries(['sub', 'name', 'picture', 'email', 'email_verified']
      .filter((key) => claims[key] !== undefined).map((key) => [key, claims[key]]));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page('Verified ID token claims', '<pre>' + escapeHtml(JSON.stringify(safeClaims, null, 2)) + '</pre><p><a href="/">Home</a></p>'));
    return;
  }
  if (url.pathname === '/logout' && request.method === 'GET') {
    const id = readCookie(request, cookieName);
    if (id) sessions.delete(id);
    setSessionCookie(response, '', 0);
    response.writeHead(303, { Location: '/' }).end();
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
}
createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page('Temporarily unavailable', '<p>Check the server configuration and retry.</p>'));
  });
}).listen(port, '0.0.0.0', () => {
  process.stdout.write('DT Identity Web Client listening on port ' + port + '\n');
});
