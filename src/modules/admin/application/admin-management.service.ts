import { randomBytes, randomUUID } from 'node:crypto';

import { verifyScryptPassword } from '../../../common/security/security.js';
import type { AdminCredential, AdminPrincipal, AdminRole, AdminStatus, AdministratorRecord } from '../domain/administrator.js';
import { hashAdminPassword } from './admin-authentication.service.js';

interface AdminManagementRepository {
  listAdministrators(page: number, pageSize: number): Promise<{ total: number; list: AdministratorRecord[] }>;
  createAdministrator(id: string, username: string, passwordHash: string, role: AdminRole, mustChangePassword: boolean): Promise<AdministratorRecord>;
  setStatus(targetId: string, status: AdminStatus): Promise<AdministratorRecord | null>;
  setRole(targetId: string, role: AdminRole): Promise<AdministratorRecord | null>;
  resetPassword(targetId: string, passwordHash: string): Promise<boolean>;
  findCredential(username: string): Promise<AdminCredential | null>;
  changeOwnPassword(targetId: string, passwordHash: string): Promise<void>;
  recordManagementAudit?(actorId: string, action: string, targetId: string, details?: Record<string, unknown>): Promise<void>;
}

export class AdminManagementError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_input' | 'self_protected' | 'last_super_admin' | 'not_found' | 'invalid_password' | 'conflict') { super(code); }
}

function assertSuperAdmin(actor: AdminPrincipal): void { if (actor.role !== 'super_admin') throw new AdminManagementError('forbidden'); }
function temporaryPassword(): string { return randomBytes(18).toString('base64url'); }

export class AdminManagementService {
  constructor(private readonly repository: AdminManagementRepository, private readonly createId: () => string = randomUUID, private readonly createTemporaryPassword: () => string = temporaryPassword) {}

  async list(actor: AdminPrincipal, page: number, pageSize: number): Promise<{ total: number; list: AdministratorRecord[] }> {
    assertSuperAdmin(actor);
    return this.repository.listAdministrators(page, pageSize);
  }

  async create(actor: AdminPrincipal, username: string, role: AdminRole): Promise<{ administrator: AdministratorRecord; temporaryPassword: string }> {
    assertSuperAdmin(actor);
    const displayName = typeof username === 'string' ? username.trim() : '';
    if (!displayName || displayName.length > 128 || !['super_admin', 'operator', 'auditor'].includes(role)) throw new AdminManagementError('invalid_input');
    const password = this.createTemporaryPassword();
    try {
      const administrator = await this.repository.createAdministrator(this.createId(), displayName, hashAdminPassword(password), role, true);
      await this.repository.recordManagementAudit?.(actor.id, 'administrator.create', administrator.id, { role });
      return { administrator, temporaryPassword: password };
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') throw new AdminManagementError('conflict');
      throw cause;
    }
  }

  async setStatus(actor: AdminPrincipal, targetId: string, status: AdminStatus): Promise<AdministratorRecord> {
    assertSuperAdmin(actor);
    if (actor.id === targetId) throw new AdminManagementError('self_protected');
    if (!['active', 'disabled'].includes(status)) throw new AdminManagementError('invalid_input');
    const result = await this.repository.setStatus(targetId, status);
    if (!result) throw new AdminManagementError('last_super_admin');
    await this.repository.recordManagementAudit?.(actor.id, 'administrator.status', targetId, { status });
    return result;
  }

  async setRole(actor: AdminPrincipal, targetId: string, role: AdminRole): Promise<AdministratorRecord> {
    assertSuperAdmin(actor);
    if (actor.id === targetId) throw new AdminManagementError('self_protected');
    if (!['super_admin', 'operator', 'auditor'].includes(role)) throw new AdminManagementError('invalid_input');
    const result = await this.repository.setRole(targetId, role);
    if (!result) throw new AdminManagementError('last_super_admin');
    await this.repository.recordManagementAudit?.(actor.id, 'administrator.role', targetId, { role });
    return result;
  }

  async resetPassword(actor: AdminPrincipal, targetId: string): Promise<{ temporaryPassword: string }> {
    assertSuperAdmin(actor);
    const password = this.createTemporaryPassword();
    if (!await this.repository.resetPassword(targetId, hashAdminPassword(password))) throw new AdminManagementError('not_found');
    await this.repository.recordManagementAudit?.(actor.id, 'administrator.password.reset', targetId);
    return { temporaryPassword: password };
  }

  async changeOwnPassword(actor: AdminPrincipal, currentPassword: string, nextPassword: string): Promise<void> {
    if (typeof currentPassword !== 'string' || typeof nextPassword !== 'string' || nextPassword.length < 12 || nextPassword.length > 1024 || currentPassword === nextPassword) throw new AdminManagementError('invalid_input');
    const credential = await this.repository.findCredential(actor.username);
    if (!credential || credential.principal.id !== actor.id || !verifyScryptPassword(currentPassword, credential.passwordHash)) throw new AdminManagementError('invalid_password');
    await this.repository.changeOwnPassword(actor.id, hashAdminPassword(nextPassword));
    await this.repository.recordManagementAudit?.(actor.id, 'administrator.password.change', actor.id);
  }
}
