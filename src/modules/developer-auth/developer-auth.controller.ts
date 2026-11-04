import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DeveloperAuthError } from './application/credential.service.js';
import { NestDeveloperAuthService } from './developer-auth.service.js';

function error(response: Response, status: number, code: string, desc: string): void { response.status(status).json({ code, desc, data: null }); }
function value(body: unknown, key: string): string { return typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>)[key] === 'string' ? String((body as Record<string, unknown>)[key]) : ''; }
function postgresCode(cause: unknown): string | undefined { return cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string' ? (cause as { code: string }).code : undefined; }
function cookie(request: Request, name: string): string | null { for (const part of (request.headers.cookie ?? '').split(';')) { const separator = part.indexOf('='); if (separator > 0 && part.slice(0, separator).trim() === name) { try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; } } } return null; }

@Controller('api/v1/developer-auth')
export class DeveloperAuthController {
  constructor(@Inject(NestDeveloperAuthService) private readonly service: NestDeveloperAuthService) {}

  private origin(request: Request, response: Response): boolean {
    if (this.service.sameOrigin(request.header('origin'))) return true;
    error(response, 403, 'origin_denied', 'Request origin is not allowed'); return false;
  }

  @Post('email-code')
  async emailCode(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.origin(request, response)) return;
    try { await this.service.issue(value(body, 'email'), typeof body === 'object' && body ? (body as Record<string, unknown>).purpose : undefined, request.ip ?? 'unknown'); response.status(202).json({ code: 0, desc: 'ok', data: 'sent' }); }
    catch (cause) { error(response, cause instanceof TypeError ? 400 : 429, 'email_code_unavailable', cause instanceof Error ? cause.message : 'Email code is unavailable'); }
  }

  @Post('register')
  @HttpCode(200)
  async register(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.origin(request, response)) return;
    try { const account = await this.service.register(value(body, 'email'), value(body, 'password'), value(body, 'code')); this.establishResponse(response, await this.service.establish(account.id, account)); }
    catch (cause) {
      if (cause instanceof DeveloperAuthError) { error(response, 400, cause.code, cause.message); return; }
      if (cause instanceof TypeError) { error(response, 400, 'invalid_registration', cause.message); return; }
      if (postgresCode(cause) === '23505') { error(response, 409, 'registration_conflict', 'Developer account could not be registered'); return; }
      error(response, 503, 'registration_unavailable', 'Developer account registration is unavailable');
    }
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.origin(request, response)) return;
    try { this.establishResponse(response, await this.service.establish(await this.service.login(value(body, 'email'), value(body, 'password')))); }
    catch (cause) {
      if (cause instanceof TypeError || cause instanceof DeveloperAuthError) { error(response, 401, 'invalid_credentials', 'Email or password is incorrect'); return; }
      error(response, 503, 'authentication_unavailable', 'Developer authentication is unavailable');
    }
  }

  @Get('session')
  async session(@Req() request: Request, @Res() response: Response): Promise<void> {
    const data = await this.service.session(cookie(request, 'md-developer'));
    response.cookie('md-developer-csrf', data.csrfToken, { httpOnly: true, sameSite: 'strict', secure: this.service.secure, path: '/', maxAge: 30 * 60 * 1000 });
    response.json({ code: 0, desc: 'ok', data });
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.origin(request, response)) return;
    if (!this.service.csrfValid(cookie(request, 'md-developer-csrf'), request.header('x-csrf-token'))) { error(response, 403, 'csrf_denied', 'Request verification failed'); return; }
    await this.service.logout(cookie(request, 'md-developer'));
    response.clearCookie('md-developer', { httpOnly: true, sameSite: 'lax', secure: this.service.secure, path: '/' });
    response.json({ code: 0, desc: 'ok', data: null });
  }

  private establishResponse(response: Response, result: { token: string; account: unknown }): void {
    response.cookie('md-developer', result.token, { httpOnly: true, sameSite: 'lax', secure: this.service.secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
    response.json({ code: 0, desc: 'ok', data: { account: result.account } });
  }
}
