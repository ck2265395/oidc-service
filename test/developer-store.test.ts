import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresDeveloperStore } from '../src/developer-store.js';

test('creates an email developer account and profile in one transaction', async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO developer_account')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'unsubmitted', revision: 1, last_review: null, submitted_at: null, approved_at: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const store = new PostgresDeveloperStore(pool as never, () => '11111111-1111-4111-8111-111111111111');

  const account = await store.createEmailAccount({
    emailNormalized: 'dev@example.com',
    emailDisplay: 'Dev@example.com',
    passwordDigest: { version: 'scrypt-v1', n: 32768, r: 8, p: 1, salt: 'abcdefghijklmnopqrstuv', hash: 'a'.repeat(86) },
  });

  assert.equal(account.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(account.status, 'unsubmitted');
  assert.equal(statements[0], 'BEGIN');
  assert.match(statements[1] ?? '', /^INSERT INTO developer_account/);
  assert.match(statements[2] ?? '', /^INSERT INTO developer_password_credential/);
  assert.match(statements[3] ?? '', /^INSERT INTO developer_profile/);
  assert.equal(statements.at(-1), 'COMMIT');
});

test('resolves only an active unexpired developer session by its digest', async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const pool = {
    async query(sql: string, values?: readonly unknown[]) {
      queries.push(values === undefined ? { sql } : { sql, values });
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          status: 'approved', revision: 4, last_review: null, submitted_at: null, approved_at: new Date().toISOString(),
        }],
        rowCount: 1,
      };
    },
  };
  const store = new PostgresDeveloperStore(pool as never);

  const account = await store.resolveSession('f'.repeat(64));

  assert.equal(account?.status, 'approved');
  assert.match(queries[0]?.sql ?? '', /revoked_at IS NULL/);
  assert.match(queries[0]?.sql ?? '', /absolute_expires_at > now\(\)/);
  assert.deepEqual(queries[0]?.values, ['f'.repeat(64)]);
});

test('rejects malformed session digests before querying PostgreSQL', async () => {
  let queried = false;
  const pool = { async query() { queried = true; return { rows: [], rowCount: 0 }; } };
  const store = new PostgresDeveloperStore(pool as never);

  assert.equal(await store.resolveSession('not-a-digest'), null);
  assert.equal(queried, false);
});
