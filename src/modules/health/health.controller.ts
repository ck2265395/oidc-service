import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(@Res() response: Response): void {
    response.status(200).json({ status: 'ok', requestId: String(response.locals.requestId) });
  }

  @Get('ready')
  async ready(@Res() response: Response): Promise<void> {
    try {
      await this.health.ready();
      response.status(200).json({ status: 'ok', requestId: String(response.locals.requestId) });
    } catch {
      response.status(503).json({ status: 'unavailable', requestId: String(response.locals.requestId) });
    }
  }
}
