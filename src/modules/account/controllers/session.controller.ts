import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { setConsoleCsrf } from '../../../common/security/http-security.js';
import { AccountApplicationService } from '../application/account.service.js';

@Controller('api/v1/session')
export class SessionController {
  constructor(@Inject(AccountApplicationService) private readonly accounts: AccountApplicationService) {}
  @Get()
  async get(@Req() request: Request, @Res() response: Response): Promise<void> {
    let account: Record<string, unknown> | null = null;
    try {
      const identity = await this.accounts.identity(request, response, 'console-bootstrap');
      if (identity) account = this.accounts.accountSummary(identity);
    } catch { account = null; }
    const authenticated = await this.accounts.adminAuthenticated(request).catch(() => false);
    const secure = this.accounts.settings.issuer.startsWith('https:');
    response.json({ code: 0, desc: 'ok', data: {
      account, admin: authenticated ? { authenticated: true, username: this.accounts.settings.admin.username } : { authenticated: false },
      csrfToken: setConsoleCsrf(response, secure),
    } });
  }
}
