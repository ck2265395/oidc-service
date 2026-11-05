import { Controller, Get, Inject, Next, Post, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response, Router } from 'express';

import { AdminService } from './admin.service.js';

export const ADMIN_PAGE_ROUTER = Symbol('ADMIN_PAGE_ROUTER');

@Controller()
export class AdminPageController {
  constructor(
    @Inject(ADMIN_PAGE_ROUTER) private readonly router: Router,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  private delegate(request: Request, response: Response, next: NextFunction): void {
    request.url = request.url.replace(/^\/admin(?=\/|$)/, '') || '/';
    this.router(request, response, next);
  }

  @Get(['admin', 'admin/{*path}'])
  async handleGet(@Req() request: Request, @Res() response: Response, @Next() next: NextFunction): Promise<void> {
    if (request.path === '/admin/login') { this.delegate(request, response, next); return; }
    if (!await this.admin.auth.authenticated(request)) { response.redirect(303, '/admin/login'); return; }
    next();
  }

  @Post('admin/login')
  handleLogin(@Req() request: Request, @Res() response: Response, @Next() next: NextFunction): void {
    this.delegate(request, response, next);
  }
}
