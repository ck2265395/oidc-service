import { createHash } from 'node:crypto';

import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import { consoleMutationAllowed, readCookie } from '../../../common/security/http-security.js';
import type { ServiceConfig } from '../../../infrastructure/config/config.schema.js';

export interface AdminAuthPort {
  authenticated(request: Request): Promise<boolean>;
  mutationAllowed(request: Request): boolean;
  logout(request: Request, response: Response): Promise<void>;
}

export class PostgresAdminAuth implements AdminAuthPort {
  constructor(private readonly pool: Pool, private readonly config: ServiceConfig) {}
  async authenticated(request: Request): Promise<boolean> {
    const token = readCookie(request, this.config.issuer.startsWith('https:') ? '__Host-dt-admin' : 'dt-admin');
    if (!token || token.length > 128) return false;
    try {
      const digest = createHash('sha256').update(token, 'utf8').digest('hex');
      const result = await this.pool.query("UPDATE admin_session SET last_activity = now() WHERE session_hash = $1 AND created_at > now() - interval '8 hours' AND last_activity > now() - interval '30 minutes' RETURNING session_hash", [digest]);
      return result.rowCount === 1;
    } catch { return false; }
  }
  mutationAllowed(request: Request): boolean { return consoleMutationAllowed(request, this.config.issuer); }
  async logout(request: Request, response: Response): Promise<void> {
    const secure = this.config.issuer.startsWith('https:');
    const name = secure ? '__Host-dt-admin' : 'dt-admin';
    const token = readCookie(request, name);
    if (token) await this.pool.query('DELETE FROM admin_session WHERE session_hash = $1', [createHash('sha256').update(token).digest('hex')]);
    response.clearCookie(name, { path: '/', httpOnly: true, secure, sameSite: 'strict' });
  }
}
