import { randomUUID } from 'node:crypto';

import type { LoggerService } from '@nestjs/common';
import type { Express, NextFunction, Request, Response } from 'express';

import type { ServiceConfig } from '../../infrastructure/config/config.schema.js';
import { requestLogger } from '../logging/request-logger.middleware.js';

const requestIdPattern = /^[A-Za-z0-9._-]{8,128}$/;
const contentSecurityPolicy = "default-src 'none'; connect-src 'self'; img-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function securityHeaders(config: ServiceConfig) {
  const strictTransport = new URL(config.issuer).protocol === 'https:';
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    if (strictTransport) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function configureHttpFoundation(
  app: Express,
  config: ServiceConfig,
  logger: Pick<LoggerService, 'log'>,
): void {
  app.set('trust proxy', config.trustedProxyCidrs.length === 0 ? false : config.trustedProxyCidrs);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const supplied = request.get('x-request-id');
    const requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  });
  app.use(securityHeaders(config));
  app.use(requestLogger(logger));
}
