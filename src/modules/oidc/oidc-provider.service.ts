import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Express, NextFunction, Request, Response, Router } from 'express';
import type Provider from 'oidc-provider';
import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';

import type { AccountService } from '../../accounts.js';
import { createOidcAdapterFactory } from '../../adapter.js';
import type { ServiceConfig } from '../../config.js';
import { createInteractionRouter } from '../../interactions.js';
import { RedisLoginRateLimiter } from '../../login-limiter.js';
import type { ApplicationService } from '../../platform.js';
import { createProvider } from '../../provider.js';
import { createUserPortalRouter } from '../../user-portal.js';
import type { SigningKeyService } from '../../infrastructure/keys/signing-key.service.js';
import type { ProviderSessionGateway } from '../account/account.module.js';
import type { ProviderSessionPort } from '../account/application/account.service.js';
import { mountProtocolMiddleware } from './oidc-protocol.middleware.js';
import { isProtocolPath } from './oidc-protocol.middleware.js';
import type { OidcAuditService } from './oidc-audit.service.js';

@Injectable()
export class OidcProviderService implements OnModuleInit {
  private providerValue: Provider | null = null;
  private interactionRouter: Router | null = null;
  private portalRouter: Router | null = null;
  constructor(
    private readonly config: ServiceConfig,
    private readonly pool: Pool,
    private readonly redis: RedisClientType,
    private readonly subscriber: RedisClientType,
    private readonly accounts: AccountService,
    private readonly applications: ApplicationService,
    private readonly keys: SigningKeyService,
    private readonly gateway: ProviderSessionGateway,
    private readonly audit: OidcAuditService,
  ) {}

  async initialize(): Promise<void> {
    if (this.providerValue) return;
    await this.keys.onModuleInit();
    const provider = createProvider(this.config.issuer, createOidcAdapterFactory(this.pool, this.applications, this.redis), this.accounts, this.applications, this.config.secrets.cookie, this.keys.get());
    const limiter = new RedisLoginRateLimiter(this.redis, this.config.secrets.fingerprint, this.config.loginRateLimit.windowSeconds, this.config.loginRateLimit.accountAttempts, this.config.loginRateLimit.ipAttempts);
    this.interactionRouter = createInteractionRouter(provider, this.accounts, this.applications, this.config.secrets.cookie, this.config.issuer.startsWith('https:'), limiter, this.config.accountPortal);
    this.portalRouter = createUserPortalRouter(this.pool, provider, this.accounts, this.config, this.redis);
    const port: ProviderSessionPort = {
      accountId: async (request, response) => { const session = await provider.Session.get(provider.createContext(request, response)); return typeof session.accountId === 'string' ? session.accountId : null; },
      revokeGrant: async (id, accountId) => { const grant = await provider.Grant.find(id); if (!grant || grant.accountId !== accountId) return null; const clientId = grant.clientId ?? null; await grant.adapter.revokeByGrantId(id); await grant.destroy(); return { clientId }; },
    };
    this.gateway.attach(port);
    this.providerValue = provider;
  }

  async onModuleInit(): Promise<void> {
    await this.initialize();
    const provider = this.provider;
    const client = provider.Client as typeof provider.Client & { cacheClear(clientId?: string): void };
    await this.subscriber.subscribe('dt:oidc:client-cache-clear', (id) => { if (/^[A-Za-z0-9._~-]{1,255}$/.test(id)) client.cacheClear(id); });
  }

  get provider(): Provider { if (!this.providerValue) throw new Error('OIDC provider is not initialized'); return this.providerValue; }
  mountProtocol(app: Express): void {
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (!isProtocolPath(request.path)) { next(); return; }
      const started = performance.now(); const endpoint = request.path; const requestId = String(response.locals.requestId ?? '');
      response.once('finish', () => {
        const status = response.statusCode; const outcome = status >= 500 ? 'failure' : status >= 400 ? 'denied' : 'success';
        const candidate = typeof request.query.client_id === 'string' && request.query.client_id.length <= 255 ? request.query.client_id : null;
        void this.audit.record({ requestId, endpoint, outcome, status, durationMs: Math.max(0, Math.round(performance.now() - started)), clientId: candidate }).catch(() => undefined);
      });
      next();
    });
    mountProtocolMiddleware(app, this.provider);
  }
  interaction(request: Request, response: Response, next: NextFunction): void { if (!this.interactionRouter) throw new Error('OIDC interactions are not initialized'); this.interactionRouter(request, response, next); }
  portal(request: Request, response: Response, next: NextFunction): void { if (!this.portalRouter) throw new Error('OIDC portal is not initialized'); this.portalRouter(request, response, next); }
}
