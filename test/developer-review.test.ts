import assert from 'node:assert/strict';
import test from 'node:test';

import { DeveloperReviewError, PostgresDeveloperStore } from '../src/developer-store.js';

const developerId = '11111111-1111-4111-8111-111111111111';

function row(status: string, revision = 1) {
  return { id: developerId, status, revision, last_review: null, submitted_at: null, approved_at: null };
}

test('submits a complete verified developer profile and stores an immutable snapshot', async () => {
  const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const client = {
    async query(sql: string, values?: readonly unknown[]) {
      statements.push(values === undefined ? { sql } : { sql, values });
      if (sql.includes('FROM developer_account') && sql.includes('FOR UPDATE')) return { rows: [row('unsubmitted')], rowCount: 1 };
      if (sql.includes('FROM developer_profile')) return { rows: [{ developer_id: developerId, display_name: '陈坤', contact_email: 'dev@example.com', contact_email_verified: true, contact_phone: null, purpose: '接入耳机配置服务', revision: 2 }], rowCount: 1 };
      if (sql.startsWith('UPDATE developer_account')) return { rows: [row('pending', 2)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const store = new PostgresDeveloperStore({ async connect() { return client; } } as never);

  const account = await store.submitReview(developerId, 1);

  assert.equal(account.status, 'pending');
  const history = statements.find(({ sql }) => sql.startsWith('INSERT INTO developer_review_history'));
  assert.ok(history);
  assert.match(String(history.values?.[5]), /接入耳机配置服务/);
  assert.equal(statements.at(-1)?.sql, 'COMMIT');
});

test('rejects submission when required profile data is incomplete', async () => {
  const client = {
    async query(sql: string) {
      if (sql.includes('FROM developer_account')) return { rows: [row('unsubmitted')], rowCount: 1 };
      if (sql.includes('FROM developer_profile')) return { rows: [{ developer_id: developerId, display_name: '', contact_email: 'dev@example.com', contact_email_verified: true, contact_phone: null, purpose: '', revision: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const store = new PostgresDeveloperStore({ async connect() { return client; } } as never);

  await assert.rejects(store.submitReview(developerId, 1), (error: unknown) => {
    assert.ok(error instanceof DeveloperReviewError);
    assert.equal(error.code, 'profile_incomplete');
    return true;
  });
});

test('administrator disable writes review history and revokes all sessions atomically', async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('FROM developer_account') && sql.includes('FOR UPDATE')) return { rows: [row('approved', 3)], rowCount: 1 };
      if (sql.includes('FROM developer_profile')) return { rows: [{ developer_id: developerId, display_name: '陈坤', contact_email: 'dev@example.com', contact_email_verified: true, contact_phone: null, purpose: 'API', revision: 1 }], rowCount: 1 };
      if (sql.startsWith('UPDATE developer_account')) return { rows: [row('disabled', 4)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const store = new PostgresDeveloperStore({ async connect() { return client; } } as never);

  const account = await store.reviewDeveloper(developerId, 3, 'disable', 'admin-1', '违反平台规则');

  assert.equal(account.status, 'disabled');
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO developer_review_history')));
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE developer_session SET revoked_at')));
  assert.equal(statements.at(-1), 'COMMIT');
});

test('locks profile edits while a developer review is pending', async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes('FROM developer_account')) return { rows: [row('pending', 2)], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const store = new PostgresDeveloperStore(pool as never);

  await assert.rejects(store.saveProfile(developerId, {
    displayName: '新名称', contactEmail: 'dev@example.com', contactEmailVerified: true,
    contactPhone: null, purpose: '新用途', expectedRevision: 1,
  }), (error: unknown) => error instanceof DeveloperReviewError && error.code === 'profile_locked');
});
