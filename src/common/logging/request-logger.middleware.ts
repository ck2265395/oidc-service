import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { classifyRoute, type HttpLogRecord } from './log-record.js';

export function requestLogger(logger: Pick<LoggerService, 'log'>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const started = performance.now();
    response.once('finish', () => {
      const path = request.path || '/';
      const record: HttpLogRecord = {
        event: 'http_request',
        requestId: String(response.locals.requestId),
        method: request.method,
        path,
        routeKind: classifyRoute(path),
        statusCode: response.statusCode,
        durationMs: Math.max(0, Math.round((performance.now() - started) * 100) / 100),
        ip: request.ip || null,
      };
      logger.log(record);
    });
    next();
  };
}
