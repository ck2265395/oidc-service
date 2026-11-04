import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminAuthenticationService, hashAdminPassword } from '../src/modules/admin/application/admin-authentication.service.js';
import { AdminBootstrapService } from '../src/modules/admin/application/admin-bootstrap.service.js';

test('administrator authentication returns only an active database principal', async () => {
  const passwordHash = hashAdminPassword('123456');
  const repository = {
    async findCredential(username: string) {
      return username === 'admin' ? { principal: { id: 'id-1', username: 'admin', mustChangePassword: true }, passwordHash, status: 'active' as const } : null;
    },
  };
  const service = new AdminAuthenticationService(repository);
  assert.deepEqual(await service.login('admin', '123456'), { id: 'id-1', username: 'admin', mustChangePassword: true });
  assert.equal(await service.login('admin', 'wrong'), null);
  assert.equal(await service.login('missing', '123456'), null);
});

test('disabled administrator credentials always fail', async () => {
  const passwordHash = hashAdminPassword('123456');
  const service = new AdminAuthenticationService({ async findCredential() { return { principal: { id: 'id-1', username: 'admin', mustChangePassword: false }, passwordHash, status: 'disabled' as const }; } });
  assert.equal(await service.login('admin', '123456'), null);
});

test('administrator bootstrap seeds only development mode', async () => {
  const calls: unknown[][] = [];
  const repository = { async createLocalDefault(...values: unknown[]) { calls.push(values); return true; } };
  await new AdminBootstrapService('development', repository, () => 'admin-id').onModuleInit();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 2), ['admin-id', 'admin']);
  assert.equal(typeof calls[0]?.[2], 'string');
  await new AdminBootstrapService('test', repository, () => 'unused').onModuleInit();
  await new AdminBootstrapService('production', repository, () => 'unused').onModuleInit();
  assert.equal(calls.length, 1);
});
