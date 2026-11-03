import assert from 'node:assert/strict';
import test from 'node:test';

import { clientIdFromRequest, installClientCacheInvalidation, protocolAuditEndpoint, protocolAuditOutcome } from '../src/modules/oidc/oidc-provider.service.js';

test('OIDC cache invalidation clears the current worker before publishing to peers', async () => {
  const events: string[] = [];
  const provider = { Client: { cacheClear(id: string) { events.push('local:' + id); } } };
  let clear: ((id: string) => void) | undefined;
  const applications = { setClientCacheClearer(value: (id: string) => void) { clear = value; } };
  const redis = { async publish() { events.push('publish'); throw new Error('offline'); } };
  const subscriber = { async subscribe(_channel: string, listener: (id: string) => void) { listener('peer-client'); } };
  await installClientCacheInvalidation(provider as never, applications as never, redis as never, subscriber as never);
  assert.ok(clear); clear('rotated-client');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['local:peer-client', 'local:rotated-client', 'publish']);
});

test('OIDC audit detects redirect errors and confidential Basic clients', () => {
  assert.equal(protocolAuditOutcome(303, 'https://rp.example/callback?error=access_denied'), 'denied');
  assert.equal(protocolAuditOutcome(303, 'https://rp.example/callback?code=ok'), 'success');
  assert.equal(clientIdFromRequest(undefined, 'Basic ' + Buffer.from('confidential-client:secret').toString('base64')), 'confidential-client');
  assert.equal(clientIdFromRequest('query-client', undefined), 'query-client');
  assert.equal(protocolAuditEndpoint('/token/revocation'), 'token.revocation');
});
