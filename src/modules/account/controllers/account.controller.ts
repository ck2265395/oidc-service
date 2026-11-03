import { Controller, Delete, Get, Inject, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { consoleMutationAllowed } from '../../../http-security.js';
import { AccountApplicationService } from '../application/account.service.js';

@Controller('api/v1/account')
export class AccountController {
  constructor(@Inject(AccountApplicationService) private readonly accounts: AccountApplicationService) {}

  @Get('authorizations')
  async list(@Req() request: Request, @Res() response: Response): Promise<void> {
    const accountId = await this.accounts.accountId(request, response);
    if (!accountId) { response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null }); return; }
    try { response.json({ code: 0, desc: 'ok', data: await this.accounts.listAuthorizations(accountId) }); }
    catch { response.status(503).json({ code: 'storage_unavailable', desc: 'Authorization data is unavailable', data: null }); }
  }

  @Delete('authorizations/:id')
  async revoke(@Param('id') id: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!consoleMutationAllowed(request, this.accounts.settings.issuer)) { response.status(403).json({ code: 'csrf_denied', desc: 'Request verification failed', data: null }); return; }
    const accountId = await this.accounts.accountId(request, response);
    if (!accountId) { response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null }); return; }
    try {
      if (!await this.accounts.revokeAuthorization(id, accountId)) { response.status(404).json({ code: 'not_found', desc: 'Authorization not found', data: null }); return; }
      response.json({ code: 0, desc: 'ok', data: { revoked: true } });
    } catch { response.status(503).json({ code: 'revoke_failed', desc: 'Revocation failed', data: null }); }
  }
}
