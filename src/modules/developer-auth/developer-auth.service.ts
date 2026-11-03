import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { DeveloperAuthService as DomainAuthService } from '../../developer-auth-service.js';
import type { DeveloperEmailCode } from '../../developer-email-code.js';
import type { DeveloperAccount } from '../../developer-identity.js';
import { normalizeDeveloperEmail } from '../../developer-identity.js';
import type { DeveloperSessionService } from '../../developer-session.js';
import { randomToken } from '../../security.js';

export interface DeveloperIdentityMethods { listAuthenticationMethods(developerId: string): Promise<string[]>; }

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

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
  sameOrigin(request: Request): boolean { return request.header('origin') === new URL(this.issuer).origin; }
  async issue(email: string, purpose: unknown, ip: string): Promise<void> {
    const normalized = normalizeDeveloperEmail(email);
    const selected = purpose === 'bind' || purpose === 'reset' ? purpose : 'register';
    await this.codes.issue(selected, normalized, ip);
  }
  register(email: string, password: string, code: string): Promise<DeveloperAccount> { return this.auth.register(email, password, code); }
  async login(email: string, password: string): Promise<string> { return (await this.auth.loginWithPassword(email, password)).developerId; }
  async establish(response: Response, developerId: string, account?: DeveloperAccount): Promise<void> {
    const token = await this.sessions.create(developerId);
    response.cookie('md-developer', token, { httpOnly: true, sameSite: 'lax', secure: this.secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
    response.json({ code: 0, desc: 'ok', data: { account: account ?? null } });
  }
  async session(request: Request): Promise<{ account: DeveloperAccount | null; authenticationMethods: string[]; csrfToken: string }> {
    const token = cookie(request, 'md-developer');
    const account = token ? await this.sessions.resolve(token) : null;
    return { account, authenticationMethods: account ? await this.identities.listAuthenticationMethods(account.id) : [], csrfToken: randomToken() };
  }
  csrfValid(request: Request): boolean {
    const leftValue = cookie(request, 'md-developer-csrf'); const rightValue = request.header('x-csrf-token');
    if (!leftValue || !rightValue) return false;
    const left = Buffer.from(leftValue); const right = Buffer.from(rightValue);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  async logout(request: Request, response: Response): Promise<void> {
    const token = cookie(request, 'md-developer'); if (token) await this.sessions.revoke(token);
    response.clearCookie('md-developer', { httpOnly: true, sameSite: 'lax', secure: this.secure, path: '/' });
  }
}
