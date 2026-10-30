import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import express, { type ErrorRequestHandler, type Express, type Router } from 'express';
import type Provider from 'oidc-provider';

import type { ServiceConfig } from './config.js';

export interface ProtocolAuditEvent {
  requestId: string;
  endpoint: string;
  outcome: 'success' | 'denied' | 'failure';
  status: number;
  durationMs: number;
  clientId: string | null;
}

export function createApplication(
  config: ServiceConfig,
  provider?: Provider,
  interactions?: Router,
  developer?: Router,
  admin?: Router,
  userPortal?: Router,
  readiness?: () => Promise<void>,
  recordProtocolEvent?: (event: ProtocolAuditEvent) => Promise<void>,
  userApi?: Router,
): Express {
  const app = express();
  const publicDirectory = resolve(process.cwd(), 'public');

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxyCidrs);
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; img-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (config.issuer.startsWith('https:')) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use('/assets', express.static(publicDirectory, { index: false, fallthrough: false, maxAge: '1h' }));
  app.get('/', (_request, response) => {
    response.sendFile(resolve(publicDirectory, 'index.html'));
  });

  app.get('/developer/login', (_request, response) => {
    response.redirect(303, '/portal/sign-in?return=%2Fdeveloper');
  });

  app.get('/developer', (_request, response) => {
    response.sendFile(resolve(publicDirectory, 'developer.html'));
  });

  app.get('/health/ready', async (_request, response) => {
    try {
      if (!readiness) throw new Error('Readiness checks are not configured');
      await readiness();
      response.status(200).json({ status: 'ok', requestId: response.locals.requestId });
    } catch {
      response.status(503).json({ status: 'unavailable', requestId: response.locals.requestId });
    }
  });

  app.get('/health/live', (_request, response) => {
    response.status(200).json({
      status: 'ok',
      requestId: response.locals.requestId,
    });
  });

  if (interactions) app.use('/interaction', interactions);
  if (userApi) app.use('/api/v1/me', userApi);
  if (developer) app.use('/api/v1/developer', developer);
  if (admin) app.use('/admin', admin);
  if (userPortal) app.use('/portal', userPortal);
  if (provider) {
    if (recordProtocolEvent) {
      app.use((request, response, next) => {
        const pathname = request.path;
        const endpoints = ['/authorize', '/auth', '/token', '/userinfo', '/me', '/revoke', '/session/end'];
        const endpoint = endpoints.find((candidate) => pathname === candidate || pathname.startsWith(candidate + '/'));
        if (!endpoint) return next();
        const startedAt = Date.now();
        const requestId = String(response.locals.requestId);
        const queryClient = typeof request.query.client_id === 'string' && request.query.client_id.length <= 255 ? request.query.client_id : null;
        const authorization = request.header('authorization') ?? '';
        let basicClient: string | null = null;
        if (/^Basic\s/i.test(authorization)) {
          try {
            const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
            const separator = decoded.indexOf(':');
            if (separator > 0 && separator <= 255) basicClient = decoded.slice(0, separator);
          } catch {
            basicClient = null;
          }
        }
        response.once('finish', () => {
          const status = response.statusCode;
          const location = String(response.getHeader('location') ?? '');
          let deniedRedirect = false;
          try {
            deniedRedirect = new URL(location, 'http://local.invalid').searchParams.has('error');
          } catch {
            deniedRedirect = false;
          }
          const outcome = status >= 500 ? 'failure' : status >= 400 || deniedRedirect ? 'denied' : 'success';
          void recordProtocolEvent({
            requestId,
            endpoint,
            outcome,
            status,
            durationMs: Math.max(0, Date.now() - startedAt),
            clientId: queryClient ?? basicClient,
          }).catch(() => {
            process.stderr.write(JSON.stringify({ event: 'protocol_audit_write_failed', requestId, endpoint }) + '\n');
          });
        });
        next();
      });
    }
    app.use(provider.callback());
  }

  app.use((_request, response) => {
    response.status(404).json({
      error: 'not_found',
      requestId: response.locals.requestId,
    });
  });

  const errors: ErrorRequestHandler = (_error: unknown, _request, response, _next) => {
    response.status(500).json({
      error: 'internal_error',
      requestId: response.locals.requestId,
    });
  };
  app.use(errors);

  return app;
}
