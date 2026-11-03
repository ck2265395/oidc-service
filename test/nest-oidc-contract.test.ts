import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { exportJWK } from 'jose';
import type { Adapter, AdapterPayload, JWKS } from 'oidc-provider';

import { createProvider, PORTAL_CLIENT_ID } from '../src/provider.js';
import { mountProtocolMiddleware } from '../src/modules/oidc/oidc-protocol.middleware.js';
import { DeveloperModule } from '../src/modules/developer/developer.module.js';
import { DeveloperService } from '../src/modules/developer/developer.service.js';

const values = new Map<string, AdapterPayload>();
class MemoryAdapter implements Adapter {
  constructor(private readonly model: string) {} private key(id: string) { return `${this.model}:${id}`; }
  async upsert(id: string, payload: AdapterPayload) { values.set(this.key(id), structuredClone(payload)); }
  async find(id: string) { return values.get(this.key(id)); } async findByUserCode() { return undefined; } async findByUid() { return undefined; }
  async consume() {} async destroy(id: string) { values.delete(this.key(id)); } async revokeByGrantId() {}
}

async function service() {
  @Module({}) class TestModule {}
  const app = await NestFactory.create(TestModule, new ExpressAdapter(), { logger: false, bodyParser: false });
  const server = app.getHttpAdapter().getInstance() as ReturnType<typeof express>;
  server.use('/api', express.json({ limit: '32kb' }));
  server.use('/api', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  const listener = app.getHttpServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve)); const address = listener.address(); assert.ok(address && typeof address !== 'string');
  const issuer = `http://127.0.0.1:${address.port}`; const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const privateJwk = await exportJWK(privateKey);
  const keys = { keys: [{ ...privateJwk, kid: 'nest-contract-signing-key', alg: 'RS256', use: 'sig' }] } as JWKS;
  const provider = createProvider(issuer, (model) => new MemoryAdapter(model), { async resolve() { return null; } } as never, { async activeClient() { return undefined; } } as never, 'c'.repeat(43), keys);
  mountProtocolMiddleware(server, provider);
  server.get('/business-probe', (_request, response) => response.json({ owner: 'nest' }));
  await app.init();
  return { issuer, close: () => app.close() };
}

test('Nest OIDC contract preserves native discovery, JWKS, redirects, and middleware scope', async (context) => {
  const target = await service(); context.after(target.close);
  const discovery = await fetch(target.issuer + '/.well-known/openid-configuration'); const metadata = await discovery.json() as Record<string, unknown>;
  assert.equal(discovery.status, 200); assert.equal(metadata.token_endpoint, target.issuer + '/token');
  assert.deepEqual(metadata.subject_types_supported, ['public']);
  assert.equal((await fetch(target.issuer + '/jwks')).status, 200);
  const query = new URLSearchParams({ client_id: PORTAL_CLIENT_ID, redirect_uri: target.issuer + '/portal/callback', response_type: 'code', scope: 'openid profile email', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: 'nest-state' });
  const redirect = await fetch(target.issuer + '/auth?' + query, { redirect: 'manual' });
  assert.equal(redirect.status, 303); assert.match(redirect.headers.get('location') ?? '', /^\/interaction\//);
  const business = await fetch(target.issuer + '/business-probe'); assert.equal(business.status, 200); assert.deepEqual(await business.json(), { owner: 'nest' });
  const token = await fetch(target.issuer + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&code=invalid' });
  assert.notEqual(token.status, 404); assert.match(token.headers.get('content-type') ?? '', /json/);
});

test('production developer services are exported globally for application composition', () => {
  const module = DeveloperModule.registerProduction();
  assert.equal(module.global, true);
  assert.ok(module.exports?.includes(DeveloperService));
});
