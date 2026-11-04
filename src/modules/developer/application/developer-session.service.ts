import { createHash } from 'node:crypto';

import type { DeveloperAccount } from '../domain/developer-identity.js';
import { randomToken } from '../../../common/security/security.js';

interface DeveloperSessionStore {
  createSession(developerId: string, sessionHash: string, absoluteExpiresAt: Date): Promise<void>;
  resolveSession(sessionHash: string): Promise<DeveloperAccount | null>;
  touchSession(sessionHash: string): Promise<void>;
  revokeSession(sessionHash: string): Promise<void>;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class DeveloperSessionService {
  constructor(
    private readonly store: DeveloperSessionStore,
    private readonly createToken: () => string = randomToken,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(developerId: string): Promise<string> {
    const token = this.createToken();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Developer session token generator returned an invalid token');
    const absoluteExpiry = new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1000);
    await this.store.createSession(developerId, hashToken(token), absoluteExpiry);
    return token;
  }

  async resolve(token: string): Promise<DeveloperAccount | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = hashToken(token);
    const account = await this.store.resolveSession(hash);
    if (!account) return null;
    if (account.status === 'disabled') {
      await this.store.revokeSession(hash);
      return null;
    }
    await this.store.touchSession(hash);
    return account;
  }

  async revoke(token: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) await this.store.revokeSession(hashToken(token));
  }
}
