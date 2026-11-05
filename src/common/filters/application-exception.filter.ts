import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { ApplicationError } from '../errors/application.error.js';

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApplicationError) {
      response.status(exception.status).json({ code: exception.code, desc: exception.description, data: null });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({ error: status === 404 ? 'not_found' : 'request_failed', requestId: String(response.locals.requestId ?? '') });
      return;
    }
    response.status(500).json({ error: 'internal_error', requestId: String(response.locals.requestId ?? '') });
  }
}
