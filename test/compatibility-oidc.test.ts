import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import test from 'node:test';

import { exportJWK } from 'jose';
import type { Adapter, AdapterPayload, JWKS } from 'oidc-provider';

import { PORTAL_CLIENT_ID, createProvider } from '../src/provider.js';
import { createTestService, testServiceConfig } from './fixtures/service-config.js';

const records = new Map<string, AdapterPayload>();

class MemoryAdapter implements Adapter {
  constructor(private readonly model: string) {}

  private key(id: string): string { return `${this.model}:${id}`; }

  async upsert(id: string, payload: AdapterPayload): Promise<void> { records.set(this.key(id), structuredClone(payload)); }
  async find(id: string): Promise<AdapterPayload | undefined> { return records.get(this.key(id)); }
  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return [...records.values()].find((payload) => payload.userCode === userCode);
  }
  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return [...records.values()].find((payload) => payload.uid === uid);
  }
  async consume(id: string): Promise<void> {
    const payload = records.get(this.key(id));
    if (payload) records.set(this.key(id), { ...payload, consumed: Math.floor(Date.now() / 1000) });
  }
  async destroy(id: string): Promise<void> { records.delete(this.key(id)); }
  async revokeByGrantId(grantId: string): Promise<void> {
    for (const [key, payload] of records) if (payload.grantId === grantId) records.delete(key);
  }
}

async function signingKeys(): Promise<JWKS> {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateJwk = await exportJWK(privateKey);
  return { keys: [{ ...privateJwk, kid: 'compatibility-signing-key', alg: 'RS256', use: 'sig' }] } as JWKS;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function oidcService() {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const config = { ...testServiceConfig(), issuer: baseUrl };
  const provider = createProvider(
    config.issuer,
    (model) => new MemoryAdapter(model),
    { async resolve() { return null; } } as never,
    { async activeClient() { return undefined; } } as never,
    config.secrets.cookie,
    await signingKeys(),
  );
  return { config, service: await createTestService({ config, provider, port }) };
}

test('legacy OIDC contract preserves discovery metadata and native responses', async (context) => {
  records.clear();
  const { config, service } = await oidcService();
  context.after(service.close);

  const response = await fetch(service.baseUrl + '/.well-known/openid-configuration');
  const metadata = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(metadata.issuer, config.issuer);
  assert.equal(metadata.authorization_endpoint, config.issuer + '/auth');
  assert.equal(metadata.token_endpoint, config.issuer + '/token');
  assert.equal(metadata.userinfo_endpoint, config.issuer + '/me');
  assert.equal(metadata.revocation_endpoint, config.issuer + '/token/revocation');
  assert.equal(metadata.end_session_endpoint, config.issuer + '/session/end');
  assert.equal(metadata.jwks_uri, config.issuer + '/jwks');
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.ok((metadata.response_types_supported as string[]).includes('code'));
  assert.ok((metadata.grant_types_supported as string[]).includes('authorization_code'));

  const jwks = await fetch(service.baseUrl + '/jwks');
  assert.equal(jwks.status, 200);
  assert.match(jwks.headers.get('content-type') ?? '', /^application\/jwk-set\+json/);
  assert.equal(((await jwks.json()) as { keys: unknown[] }).keys.length, 1);
});

test('legacy OIDC contract redirects authorization into the interaction flow', async (context) => {
  records.clear();
  const { config, service } = await oidcService();
  context.after(service.close);
  const query = new URLSearchParams({
    client_id: PORTAL_CLIENT_ID,
    redirect_uri: config.issuer + '/portal/callback',
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    state: 'compatibility-state',
  });

  const response = await fetch(service.baseUrl + '/auth?' + query, { redirect: 'manual' });

  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /^\/interaction\/[A-Za-z0-9_-]+$/);
  assert.match(response.headers.get('set-cookie') ?? '', /_interaction=/);
});
