import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DeveloperAuthService as DomainAuthService } from './application/credential.service.js';
import type { DeveloperEmailCode } from './domain/email-code.js';
import type { DeveloperAccount } from '../developer/domain/developer-identity.js';
import { normalizeDeveloperEmail } from '../developer/domain/developer-identity.js';
import type { DeveloperSessionService } from '../developer/application/developer-session.service.js';
import { randomToken } from '../../common/security/security.js';

export interface DeveloperIdentityMethods { listAuthenticationMethods(developerId: string): Promise<string[]>; }

@Injectable()
export class NestDeveloperAuthService {
  constructor(
    readonly issuer: string,
    private readonly auth: Pick<DomainAuthService, 'register' | 'loginWithPassword'>,
    private readonly codes: Pick<DeveloperEmailCode, 'issue'>,
    private readonly sessions: Pick<DeveloperSessionService, 'create' | 'resolve' | 'revoke'>,
    private readonly identities: DeveloperIdentityMethods,
  ) {}

  get secure(): boolean { return this.issuer.startsWith('https:'); }
  sameOrigin(origin: string | undefined): boolean { return origin === new URL(this.issuer).origin; }
  async issue(email: string, purpose: unknown, ip: string): Promise<void> {
    const normalized = normalizeDeveloperEmail(email);
    const selected = purpose === 'bind' || purpose === 'reset' ? purpose : 'register';
    await this.codes.issue(selected, normalized, ip);
  }
  register(email: string, password: string, code: string): Promise<DeveloperAccount> { return this.auth.register(email, password, code); }
  async login(email: string, password: string): Promise<string> { return (await this.auth.loginWithPassword(email, password)).developerId; }
  async establish(developerId: string, account?: DeveloperAccount): Promise<{ token: string; account: DeveloperAccount | null }> {
    const token = await this.sessions.create(developerId);
    return { token, account: account ?? null };
  }
  async session(token: string | null): Promise<{ account: DeveloperAccount | null; authenticationMethods: string[]; csrfToken: string }> {
    const account = token ? await this.sessions.resolve(token) : null;
    return { account, authenticationMethods: account ? await this.identities.listAuthenticationMethods(account.id) : [], csrfToken: randomToken() };
  }
  csrfValid(leftValue: string | null, rightValue: string | undefined): boolean {
    if (!leftValue || !rightValue) return false;
    const left = Buffer.from(leftValue); const right = Buffer.from(rightValue);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  async logout(token: string | null): Promise<void> { if (token) await this.sessions.revoke(token); }
}
