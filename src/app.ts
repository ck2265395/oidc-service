import { randomUUID } from 'node:crypto';

import express, { type ErrorRequestHandler, type Express, type Router } from 'express';
import type Provider from 'oidc-provider';

import type { ServiceConfig } from './config.js';

export function createApplication(
  _config: ServiceConfig,
  provider?: Provider,
  interactions?: Router,
): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/health/live', (_request, response) => {
    response.status(200).json({
      status: 'ok',
      requestId: response.locals.requestId,
    });
  });

  if (interactions) app.use('/interaction', interactions);
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
