import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresAdminRepository } from '../src/modules/admin/infrastructure/admin.repository.js';

test('administrator repository uses normalized parameterized lookup', async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const repository = new PostgresAdminRepository({
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ id: 'admin-id', username: 'Admin', password_hash: 'hash', role: 'super_admin', status: 'active', must_change_password: true }], rowCount: 1 };
    },
  } as never);
  const credential = await repository.findCredential('  AdMiN  ');
  assert.equal(credential?.principal.username, 'Admin');
  assert.equal(credential?.principal.role, 'super_admin');
  assert.deepEqual(calls[0]?.values, ['admin']);
  assert.match(calls[0]?.sql ?? '', /username_normalized = \$1/);
});

test('administrator repository creates one local default only when the table is empty', async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const repository = new PostgresAdminRepository({ async query(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } } as never);
  assert.equal(await repository.createLocalDefault('admin-id', 'admin', 'scrypt-hash'), true);
  assert.match(calls[0]?.sql ?? '', /NOT EXISTS/);
  assert.match(calls[0]?.sql ?? '', /ON CONFLICT/);
  assert.deepEqual(calls[0]?.values, ['admin-id', 'admin', 'admin', 'scrypt-hash', 'super_admin']);
});

test('administrator repository explicitly creates a database administrator', async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const repository = new PostgresAdminRepository({ async query(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } } as never);
  await repository.createAdministrator('admin-id', ' Operations ', 'scrypt-hash', 'operator', true);
  assert.match(calls[0]?.sql ?? '', /^INSERT INTO platform_admin/);
  assert.deepEqual(calls[0]?.values, ['admin-id', 'Operations', 'operations', 'scrypt-hash', 'operator', true]);
});

test('administrator sessions are owned by an active administrator', async () => {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const repository = new PostgresAdminRepository({
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return sql.startsWith('UPDATE')
        ? { rows: [{ id: 'admin-id', username: 'admin', role: 'auditor', must_change_password: false }], rowCount: 1 }
        : { rows: [], rowCount: 1 };
    },
  } as never);
  await repository.createSession('admin-id', 'a'.repeat(64));
  assert.deepEqual(calls[0]?.values, ['admin-id', 'a'.repeat(64)]);
  assert.deepEqual(await repository.resolveSession('a'.repeat(64)), { id: 'admin-id', username: 'admin', role: 'auditor', mustChangePassword: false });
  assert.match(calls[1]?.sql ?? '', /status = 'active'/);
  assert.match(calls[1]?.sql ?? '', /FROM platform_admin/);
});

test('password reset rolls back password, session revocation, and audit together', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO platform_audit')) throw new Error('audit unavailable');
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push('RELEASE'); },
  };
  const repository = new PostgresAdminRepository({ async query() { throw new Error('pool query must not be used'); }, async connect() { return client; } } as never);
  await assert.rejects(() => repository.resetPassword('actor-id', 'target-id', 'next-hash'), /audit unavailable/);
  assert.ok(calls.some((sql) => sql.startsWith('UPDATE platform_admin')));
  assert.ok(calls.some((sql) => sql.startsWith('DELETE FROM admin_session')));
  assert.ok(calls.some((sql) => sql.startsWith('INSERT INTO platform_audit')));
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.includes('COMMIT'));
});
