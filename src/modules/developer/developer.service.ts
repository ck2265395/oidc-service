import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ServiceConfig } from '../../config.js';
import type { DeveloperAccount, DeveloperStatus } from '../../developer-identity.js';
import type { DeveloperSessionService } from '../../developer-session.js';
import type { PostgresDeveloperStore } from '../../developer-store.js';

export interface DeveloperStorePort extends Pick<PostgresDeveloperStore, 'getProfile' | 'saveProfile' | 'submitReview' | 'listReviewHistory' | 'findByExternalIdentity' | 'createExternalAccount' | 'bindExternalIdentity'> {}
export interface MoondropSubjectPort { subject(request: Request, response: Response): Promise<string | null>; }
export interface DeveloperCredentialPort { login(email: string, password: string): Promise<string>; }

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

@Injectable()
export class DeveloperService {
  constructor(
    readonly config: ServiceConfig,
    private readonly sessions: Pick<DeveloperSessionService, 'resolve' | 'create'>,
    readonly store: DeveloperStorePort,
    private readonly moondrop: MoondropSubjectPort,
    private readonly credentials: DeveloperCredentialPort,
  ) {}
  async authenticated(request: Request): Promise<{ id: string; status: DeveloperStatus } | null> {
    const token = cookie(request, 'md-developer');
    if (!token) return null;
    const account: DeveloperAccount | null = await this.sessions.resolve(token);
    return account ? { id: account.id, status: account.status } : null;
  }
  writeAllowed(request: Request): 'origin' | 'csrf' | true {
    if (request.header('origin') !== new URL(this.config.issuer).origin) return 'origin';
    const name = this.config.issuer.startsWith('https:') ? '__Host-dt-api-csrf' : 'dt-api-csrf';
    const fromCookie = cookie(request, name); const fromHeader = request.header('x-csrf-token');
    if (!fromCookie || !fromHeader) return 'csrf';
    const left = Buffer.from(fromCookie); const right = Buffer.from(fromHeader);
    return left.length === right.length && timingSafeEqual(left, right) ? true : 'csrf';
  }
  moondropSubject(request: Request, response: Response): Promise<string | null> { return this.moondrop.subject(request, response); }
  login(email: string, password: string): Promise<string> { return this.credentials.login(email, password); }
  async establish(response: Response, developerId: string): Promise<void> {
    const token = await this.sessions.create(developerId);
    response.cookie('md-developer', token, { httpOnly: true, sameSite: 'lax', secure: this.config.issuer.startsWith('https:'), path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
  }
}
