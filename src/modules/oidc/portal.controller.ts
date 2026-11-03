import { All, Controller, Get, Inject, Next, Query, Redirect, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { OidcProviderService } from './oidc-provider.service.js';

@Controller()
export class PortalController {
  constructor(@Inject(OidcProviderService) private readonly oidc: OidcProviderService) {}
  @All('portal/{*path}') portal(@Req() request: Request, @Res() response: Response, @Next() next: NextFunction): void { this.oidc.portal(request, response, next); }
  @Get('developer/login/moondrop')
  @Redirect()
  login(@Query('returnTo') value?: string) { const target = value && /^\/(?:developer|account)(?:\/|$)/.test(value) ? value : '/developer/console/overview'; return { statusCode: 303, url: '/portal/sign-in?return=' + encodeURIComponent('/developer/bind?returnTo=' + encodeURIComponent(target)) }; }
  @Get('developer') @Redirect('/developer/overview', 303) developer(): void {}
  @Get('account') @Redirect('/account/profile', 303) account(): void {}
}
