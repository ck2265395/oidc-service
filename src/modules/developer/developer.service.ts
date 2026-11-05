import { Injectable } from '@nestjs/common';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import type { DeveloperAccount, DeveloperStatus } from './domain/developer-identity.js';
import type { DeveloperSessionService } from './application/developer-session.service.js';
import type { PostgresDeveloperStore } from './infrastructure/developer.store.js';

export type DeveloperStorePort = Pick<PostgresDeveloperStore, 'getProfile' | 'saveProfile' | 'submitReview' | 'listReviewHistory' | 'findByExternalIdentity' | 'createExternalAccount' | 'bindExternalIdentity'>;
export interface MoondropSubjectPort { subject(request: unknown, response: unknown): Promise<string | null>; }
export interface DeveloperCredentialPort { login(email: string, password: string): Promise<string>; }
export interface DeveloperEmailVerificationPort { request(accountUuid: string): Promise<'sent' | 'already_verified'>; consume(token: string): Promise<boolean>; }

@Injectable()
export class DeveloperService {
  private emailVerification: DeveloperEmailVerificationPort | null = null;
  constructor(
    readonly config: ServiceConfig,
    private readonly sessions: Pick<DeveloperSessionService, 'resolve' | 'create'>,
    readonly store: DeveloperStorePort,
    private readonly moondrop: MoondropSubjectPort,
    private readonly credentials: DeveloperCredentialPort,
  ) {}
  async authenticated(token: string | null): Promise<{ id: string; status: DeveloperStatus } | null> {
    if (!token) return null;
    const account: DeveloperAccount | null = await this.sessions.resolve(token);
    return account ? { id: account.id, status: account.status } : null;
  }
  moondropSubject(request: unknown, response: unknown): Promise<string | null> { return this.moondrop.subject(request, response); }
  login(email: string, password: string): Promise<string> { return this.credentials.login(email, password); }
  establish(developerId: string): Promise<string> { return this.sessions.create(developerId); }
  profile(developerId: string) { return this.store.getProfile(developerId); }
  attachEmailVerification(verification: DeveloperEmailVerificationPort | null): void { this.emailVerification = verification; }
  hasEmailVerification(): boolean { return this.emailVerification !== null; }
  requestEmailVerification(accountUuid: string): Promise<'sent' | 'already_verified'> | null { return this.emailVerification?.request(accountUuid) ?? null; }
  consumeEmailVerification(token: string): Promise<boolean> | null { return this.emailVerification?.consume(token) ?? null; }
}
