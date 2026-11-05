import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminManagementError, AdminManagementService } from '../src/modules/admin/application/admin-management.service.js';
import { hashAdminPassword } from '../src/modules/admin/application/admin-authentication.service.js';

const superAdmin = { id: 'admin-1', username: 'root', role: 'super_admin' as const, mustChangePassword: false };

test('super administrator creates an operator with a one-time temporary password', async () => {
  const calls: unknown[][] = [];
  const repository = {
    async createManagedAdministrator(...values: unknown[]) { calls.push(values); return { id: values[1], username: values[2], role: values[4], status: 'active', mustChangePassword: true }; },
  };
  const service = new AdminManagementService(repository as never, () => 'new-id', () => 'temporary-password-123');
  const result = await service.create(superAdmin, ' Operations ', 'operator');
  assert.equal(result.temporaryPassword, 'temporary-password-123');
  assert.deepEqual(result.administrator, { id: 'new-id', username: 'Operations', role: 'operator', status: 'active', mustChangePassword: true });
  assert.equal(calls[0]?.[0], superAdmin.id);
  assert.equal(calls[0]?.[4], 'operator');
  assert.notEqual(calls[0]?.[3], 'temporary-password-123');
});

test('non-super administrators cannot manage administrator accounts', async () => {
  const service = new AdminManagementService({} as never);
  await assert.rejects(() => service.create({ ...superAdmin, role: 'operator' }, 'next', 'auditor'), (error: unknown) => error instanceof AdminManagementError && error.code === 'forbidden');
});

test('administrator cannot disable or change their own role', async () => {
  const service = new AdminManagementService({} as never);
  await assert.rejects(() => service.setStatus(superAdmin, superAdmin.id, 'disabled'), (error: unknown) => error instanceof AdminManagementError && error.code === 'self_protected');
  await assert.rejects(() => service.setRole(superAdmin, superAdmin.id, 'auditor'), (error: unknown) => error instanceof AdminManagementError && error.code === 'self_protected');
});

test('repository conflict preserves the last active super administrator', async () => {
  const repository = { async setStatus() { return null; } };
  const service = new AdminManagementService(repository as never);
  await assert.rejects(() => service.setStatus(superAdmin, 'admin-2', 'disabled'), (error: unknown) => error instanceof AdminManagementError && error.code === 'last_super_admin');
});

test('password reset returns a generated password once and revokes existing sessions', async () => {
  const calls: unknown[][] = [];
  const repository = { async resetPassword(...values: unknown[]) { calls.push(values); return true; } };
  const service = new AdminManagementService(repository as never, undefined, () => 'reset-password-123');
  const result = await service.resetPassword(superAdmin, 'admin-2');
  assert.equal(result.temporaryPassword, 'reset-password-123');
  assert.equal(calls[0]?.[0], superAdmin.id);
  assert.equal(calls[0]?.[1], 'admin-2');
  assert.notEqual(calls[0]?.[2], 'reset-password-123');
});

test('administrator changes their own password only after current password verification', async () => {
  const currentHash = hashAdminPassword('current-password');
  const calls: unknown[][] = [];
  const repository = {
    async findCredential() { return { principal: superAdmin, passwordHash: currentHash, status: 'active' as const }; },
    async changeOwnPassword(...values: unknown[]) { calls.push(values); },
  };
  const service = new AdminManagementService(repository as never);
  await assert.rejects(() => service.changeOwnPassword(superAdmin, 'wrong-password', 'next-password-123'), (error: unknown) => error instanceof AdminManagementError && error.code === 'invalid_password');
  await service.changeOwnPassword(superAdmin, 'current-password', 'next-password-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], superAdmin.id);
});
