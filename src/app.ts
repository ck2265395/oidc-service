import { randomUUID } from 'node:crypto';

import express, { type ErrorRequestHandler, type Express } from 'express';

import type { ServiceConfig } from './config.js';

export function createApplication(_config: ServiceConfig): Express {
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

  app.use((_request, response) => {
    response.status(404).json({
      error: 'not_found',
      requestId: response.locals.requestId,
    });
  });

  const errors: ErrorRequestHandler = (_error: unknown, _request, response, _next) => {
    // Never send error details or request data to the client.
    response.status(500).json({
      error: 'internal_error',
      requestId: response.locals.requestId,
    });
  };
  app.use(errors);

  return app;
}