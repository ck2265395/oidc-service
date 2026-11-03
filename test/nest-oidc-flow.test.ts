import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { exportJWK } from 'jose';
import type { Adapter, AdapterPayload, JWKS } from 'oidc-provider';

import { accountHandle, createProvider, PORTAL_CLIENT_ID } from '../src/provider.js';
import { mountProtocolMiddleware } from '../src/modules/oidc/oidc-protocol.middleware.js';

const values = new Map<string, AdapterPayload>();
class FlowAdapter implements Adapter {
  constructor(private readonly model: string) {} private key(id: string) { return `${this.model}:${id}`; }
  async upsert(id: string, payload: AdapterPayload) { values.set(this.key(id), structuredClone(payload)); }
  async find(id: string) { return values.get(this.key(id)); }
  async findByUserCode(code: string) { return [...values].find(([key, value]) => key.startsWith(this.model + ':') && value.userCode === code)?.[1]; }
  async findByUid(uid: string) { return [...values].find(([key, value]) => key.startsWith(this.model + ':') && value.uid === uid)?.[1]; }
  async consume(id: string) { const value = values.get(this.key(id)); if (value) values.set(this.key(id), { ...value, consumed: Math.floor(Date.now() / 1000) }); }
  async destroy(id: string) { values.delete(this.key(id)); }
  async revokeByGrantId(grantId: string) { for (const [key, value] of values) if (value.grantId === grantId || key === `Grant:${grantId}`) values.delete(key); }
}

test('Nest OIDC contract completes PKCE token, user-info, revocation, and logout', async (context) => {
  values.clear();
  @Module({}) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false, bodyParser: false });
  const server = app.getHttpAdapter().getInstance() as ReturnType<typeof express>;
  server.use('/api', express.json({ limit: '32kb' }));
  server.use('/api', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  const listener = app.getHttpServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve)); context.after(() => app.close());
  const address = listener.address(); assert.ok(address && typeof address !== 'string'); const issuer = `http://127.0.0.1:${address.port}`;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const privateJwk = await exportJWK(privateKey);
  const provider = createProvider(issuer, (model) => new FlowAdapter(model), {
    async resolve() { return { uuid: 'account-1', sub: 'pairwise-subject', fingerprint: 'f'.repeat(43), profile: { nickname: 'Moon', email: 'moon@example.test', picture: null } }; },
  } as never, { async activeClient() { return undefined; } } as never, 'c'.repeat(43), { keys: [{ ...privateJwk, kid: 'flow-signing-key-01', alg: 'RS256', use: 'sig' }] } as JWKS);
  server.get('/interaction/:uid', async (request, response) => {
    const details = await provider.interactionDetails(request, response);
    if (details.prompt.name === 'login') { await provider.interactionFinished(request, response, { login: { accountId: accountHandle('account-1', 'f'.repeat(43)) } }); return; }
    const accountId = details.session?.accountId; const clientId = String(details.params.client_id ?? ''); assert.ok(accountId && clientId);
    const grant = new provider.Grant({ accountId, clientId }); grant.addOIDCScope(String(details.params.scope ?? 'openid')); const grantId = await grant.save();
    await provider.interactionFinished(request, response, { consent: { grantId } });
  });
  mountProtocolMiddleware(server, provider);
  await app.init();

  const cookies = new Map<string, string>();
  const request = async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); if (cookies.size) headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const result = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const cookie of result.headers.getSetCookie()) { const pair = cookie.split(';', 1)[0] ?? ''; const index = pair.indexOf('='); if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    return result;
  };
  const verifier = 'v'.repeat(43); const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL('/auth', issuer); for (const [key, value] of Object.entries({ client_id: PORTAL_CLIENT_ID, redirect_uri: issuer + '/portal/callback', response_type: 'code', scope: 'openid profile email', code_challenge: challenge, code_challenge_method: 'S256', state: 'flow-state' })) authorize.searchParams.set(key, value);
  let response = await request(authorize.toString()); let location = response.headers.get('location'); const trace: Array<[number, string | null]> = [[response.status, location]];
  for (let step = 0; step < 10 && location && new URL(location, issuer).origin === issuer && new URL(location, issuer).pathname !== '/portal/callback'; step += 1) { response = await request(new URL(location, issuer).toString()); location = response.headers.get('location'); trace.push([response.status, location]); }
  assert.ok(location); const callback = new URL(location, issuer); assert.equal(callback.pathname, '/portal/callback', JSON.stringify(trace)); const code = callback.searchParams.get('code'); assert.ok(code);

  const token = await request(issuer + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: PORTAL_CLIENT_ID, redirect_uri: issuer + '/portal/callback', code, code_verifier: verifier }) });
  assert.equal(token.status, 200); const tokens = await token.json() as { access_token: string; id_token: string };
  const profile = await request(issuer + '/me', { headers: { authorization: `Bearer ${tokens.access_token}` } }); assert.equal(profile.status, 200); assert.equal((await profile.json() as { sub: string }).sub, accountHandle('account-1', 'f'.repeat(43)));
  const revoked = await request(issuer + '/token/revocation', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.access_token, client_id: PORTAL_CLIENT_ID }) }); assert.equal(revoked.status, 200);
  assert.equal((await request(issuer + '/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  const logout = await request(issuer + '/session/end?id_token_hint=' + encodeURIComponent(tokens.id_token)); assert.ok([200, 303].includes(logout.status));
});
