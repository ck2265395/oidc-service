import { All, Controller, Inject, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { OidcProviderService } from './oidc-provider.service.js';

@Controller('interaction')
export class InteractionController {
  constructor(@Inject(OidcProviderService) private readonly oidc: OidcProviderService) {}
  @All('{*path}') handle(@Req() request: Request, @Res() response: Response, @Next() next: NextFunction): void { this.oidc.interaction(request, response, next); }
}
