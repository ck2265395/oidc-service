import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AccountApplicationService } from '../application/account.service.js';

@Controller('api/v1/me')
export class MeController {
  constructor(@Inject(AccountApplicationService) private readonly accounts: AccountApplicationService) {}
  @Get()
  async get(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const identity = await this.accounts.identity(request, response, 'user-profile-api');
      if (!identity) { response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null }); return; }
      response.json({ code: 0, desc: 'ok', data: this.accounts.profile(identity) });
    } catch {
      response.status(503).json({ code: 'profile_unavailable', desc: 'Profile data is unavailable', data: null });
    }
  }
}
