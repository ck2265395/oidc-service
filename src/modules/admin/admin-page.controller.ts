import { Controller, Get, Inject, Next, Post, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response, Router } from 'express';

export const ADMIN_PAGE_ROUTER = Symbol('ADMIN_PAGE_ROUTER');

@Controller()
export class AdminPageController {
  constructor(@Inject(ADMIN_PAGE_ROUTER) private readonly router: Router) {}

  @Get('admin/login')
  @Post('admin/login')
  handle(@Req() request: Request, @Res() response: Response, @Next() next: NextFunction): void {
    request.url = request.url.replace(/^\/admin(?=\/|$)/, '') || '/';
    this.router(request, response, next);
  }
}
