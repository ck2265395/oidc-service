import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import express from 'express';
import type Provider from 'oidc-provider';

import { createDeveloperRouter } from '../src/developer.js';

test('an authenticated unbound MOONDROP account can explicitly create a developer identity', async (context) => {
  const account = { id: 'dev-1', status: 'unsubmitted', revision: 1, lastReview: null, submittedAt: null, approvedAt: null } as const;
  let createdSubject = '';
  const provider = { createContext: () => ({}), Session: { get: async () => ({ accountId: `moon-subject.${'f'.repeat(43)}` }) } } as unknown as Provider;
  const accounts = { resolve: async () => ({ uuid: 'moon-subject' }) };
  const sessions = { async resolve() { return null; }, async create() { return 's'.repeat(43); } };
  const store = {
    async findByExternalIdentity() { return null; },
    async createExternalAccount(_provider: string, subject: string) { createdSubject = subject; return account; },
    async bindExternalIdentity() {}, async getProfile() { return null; }, async saveProfile() { throw new Error(); }, async submitReview() { throw new Error(); }, async listReviewHistory() { return []; },
  };
  const router = createDeveloperRouter(provider, accounts as never, {} as never, {} as never, 'http://127.0.0.1:3000', false, null, sessions as never, store as never, null);
  const app = express(); app.use('/api/v1/developer', router);
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/developer`;

  const csrf = await fetch(base + '/csrf');
  const csrfBody = await csrf.json() as { data: { token: string } };
  const response = await fetch(base + '/moondrop/create', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3000', 'x-csrf-token': csrfBody.data.token, cookie: `dt-api-csrf=${csrfBody.data.token}` },
  });

  assert.equal(response.status, 201);
  assert.equal(createdSubject, 'moon-subject');
  assert.match(response.headers.get('set-cookie') ?? '', /md-developer=/);
});
