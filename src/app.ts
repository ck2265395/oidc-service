import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import express, { type ErrorRequestHandler, type Express, type Router } from 'express';
import type Provider from 'oidc-provider';

import type { ServiceConfig } from './config.js';

export function createApplication(
  config: ServiceConfig,
  provider?: Provider,
  interactions?: Router,
  developer?: Router,
  admin?: Router,
  userPortal?: Router,
  readiness?: () => Promise<void>,
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
  if (developer) app.use('/api/v1/developer', developer);
  if (admin) app.use('/admin', admin);
  if (userPortal) app.use('/portal', userPortal);
  if (provider) app.use(provider.callback());

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
