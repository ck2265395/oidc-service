import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';

import { configureHttpFoundation } from '../src/common/middleware/request-context.middleware.js';
import { testServiceConfig } from './fixtures/service-config.js';

async function service(trustedProxyCidrs: string[] = []) {
  const records: unknown[] = [];
  const app = express();
  configureHttpFoundation(app, { ...testServiceConfig(), trustedProxyCidrs }, { log(value: unknown) { records.push(value); } });
  app.use(express.json());
  app.all('/probe', (request, response) => response.json({ requestId: response.locals.requestId, protocol: request.protocol, ip: request.ip }));
  app.all('/token', (_request, response) => response.status(201).json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}`, records, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('logs one bounded completion event without sensitive request data', async (context) => {
  const target = await service(); context.after(target.close);
  const response = await fetch(target.baseUrl + '/probe?token=query-canary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer auth-canary', cookie: 'sid=cookie-canary' },
    body: JSON.stringify({ password: 'password-canary', code: 'code-canary', client_secret: 'secret-canary' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(target.records.length, 1);
  const serialized = JSON.stringify(target.records[0]);
  assert.match(serialized, /"event":"http_request"/);
  assert.match(serialized, /"path":"\/probe"/);
  assert.doesNotMatch(serialized, /query-canary|auth-canary|cookie-canary|password-canary|code-canary|secret-canary/);
});

test('normalizes protocol paths without query strings', async (context) => {
  const target = await service(); context.after(target.close);
  await fetch(target.baseUrl + '/token?code=protocol-canary', { method: 'POST' });
  assert.equal((target.records[0] as { path: string }).path, '/token');
  assert.equal((target.records[0] as { routeKind: string }).routeKind, 'protocol');
  assert.doesNotMatch(JSON.stringify(target.records[0]), /protocol-canary/);
});

test('preserves supplied request IDs only when syntactically safe', async (context) => {
  const target = await service(); context.after(target.close);
  const safe = await fetch(target.baseUrl + '/probe', { headers: { 'x-request-id': 'request-safe_123' } });
  const unsafe = await fetch(target.baseUrl + '/probe', { headers: { 'x-request-id': 'bad id value' } });
  assert.equal(safe.headers.get('x-request-id'), 'request-safe_123');
  assert.match(unsafe.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});

test('trusts forwarded protocol and IP only from configured proxies', async (context) => {
  const untrusted = await service(); const trusted = await service(['127.0.0.1/32']);
  context.after(async () => { await Promise.all([untrusted.close(), trusted.close()]); });
  const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.44' };
  const left = await (await fetch(untrusted.baseUrl + '/probe', { headers })).json() as { protocol: string; ip: string };
  const right = await (await fetch(trusted.baseUrl + '/probe', { headers })).json() as { protocol: string; ip: string };
  assert.equal(left.protocol, 'http');
  assert.notEqual(left.ip, '192.0.2.44');
  assert.equal(right.protocol, 'https');
  assert.equal(right.ip, '192.0.2.44');
});
