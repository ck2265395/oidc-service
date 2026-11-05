import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { setConsoleCsrf } from '../../../common/security/http-security.js';
import { AccountApplicationService } from '../application/account.service.js';
import type { ProviderSessionPort } from '../account.module.js';
import { ADMIN_SESSION_AUTH, PROVIDER_SESSIONS } from '../account.tokens.js';
import type { AdminAuthPort } from '../../admin/infrastructure/admin-auth.js';

@Controller('api/v1/session')
export class SessionController {
  constructor(
    @Inject(AccountApplicationService) private readonly accounts: AccountApplicationService,
    @Inject(ADMIN_SESSION_AUTH) private readonly adminAuth: Pick<AdminAuthPort, 'authenticated'>,
    @Inject(PROVIDER_SESSIONS) private readonly sessions: ProviderSessionPort,
  ) {}
  @Get()
  async get(@Req() request: Request, @Res() response: Response): Promise<void> {
    let account: Record<string, unknown> | null = null;
    try {
      const identity = await this.accounts.identity(await this.sessions.accountId(request, response), 'console-bootstrap');
      if (identity) account = this.accounts.accountSummary(identity);
    } catch { account = null; }
    const administrator = await this.adminAuth.authenticated(request).catch(() => null);
    const secure = this.accounts.settings.issuer.startsWith('https:');
    response.json({ code: 0, desc: 'ok', data: {
      account, admin: administrator ? { authenticated: true, username: administrator.username, role: administrator.role, mustChangePassword: administrator.mustChangePassword } : { authenticated: false },
      csrfToken: setConsoleCsrf(response, secure),
    } });
  }
}
