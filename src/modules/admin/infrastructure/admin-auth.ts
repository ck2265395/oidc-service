import { createHash } from 'node:crypto';

import type { Request, Response } from 'express';
import { consoleMutationAllowed, readCookie } from '../../../common/security/http-security.js';
import type { ServiceConfig } from '../../../infrastructure/config/config.schema.js';
import type { AdminPrincipal } from '../domain/administrator.js';
import type { PostgresAdminRepository } from './admin.repository.js';

export interface AdminAuthPort {
  authenticated(request: Request): Promise<AdminPrincipal | null>;
  mutationAllowed(request: Request): boolean;
  logout(request: Request, response: Response): Promise<void>;
}

export class PostgresAdminAuth implements AdminAuthPort {
  constructor(private readonly repository: Pick<PostgresAdminRepository, 'resolveSession' | 'deleteSession'>, private readonly config: ServiceConfig) {}
  async authenticated(request: Request): Promise<AdminPrincipal | null> {
    const token = readCookie(request, this.config.issuer.startsWith('https:') ? '__Host-dt-admin' : 'dt-admin');
    if (!token || token.length > 128) return null;
    try {
      const digest = createHash('sha256').update(token, 'utf8').digest('hex');
      return await this.repository.resolveSession(digest);
    } catch { return null; }
  }
  mutationAllowed(request: Request): boolean { return consoleMutationAllowed(request, this.config.issuer); }
  async logout(request: Request, response: Response): Promise<void> {
    const secure = this.config.issuer.startsWith('https:');
    const name = secure ? '__Host-dt-admin' : 'dt-admin';
    const token = readCookie(request, name);
    if (token) await this.repository.deleteSession(createHash('sha256').update(token).digest('hex'));
    response.clearCookie(name, { path: '/', httpOnly: true, secure, sameSite: 'strict' });
  }
}
