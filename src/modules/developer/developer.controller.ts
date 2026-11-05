import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DeveloperReviewError } from './infrastructure/developer.store.js';
import { EmailVerificationError } from './application/email-verification.service.js';
import { randomToken } from '../../common/security/security.js';
import { DeveloperService } from './developer.service.js';
import { developerCookie, developerWriteAllowed, setDeveloperSession } from './infrastructure/developer-http.js';

function jsonError(response: Response, status: number, code: string, desc: string): void { response.status(status).json({ code, desc, data: null }); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

@Controller('api/v1/developer')
export class DeveloperController {
  constructor(@Inject(DeveloperService) private readonly service: DeveloperService) {}

  private write(request: Request, response: Response): boolean {
    const allowed = developerWriteAllowed(request, this.service.config.issuer);
    if (allowed === true) return true;
    jsonError(response, 403, allowed === 'origin' ? 'origin_denied' : 'csrf_denied', allowed === 'origin' ? 'Request origin is not allowed' : 'Request verification failed'); return false;
  }
  private async owner(request: Request, response: Response): Promise<string | null> {
    const developer = await this.service.authenticated(developerCookie(request, 'md-developer'));
    if (!developer) { jsonError(response, 401, 'authentication_required', 'Sign in is required'); return null; }
    return developer.id;
  }

  @Get('csrf')
  async csrf(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!await this.owner(request, response)) return;
    const token = randomToken(); const secure = this.service.config.issuer.startsWith('https:');
    response.cookie(secure ? '__Host-dt-api-csrf' : 'dt-api-csrf', token, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 30 * 60 * 1000 });
    response.json({ code: 0, desc: 'ok', data: { token } });
  }

  @Get('profile')
  async profile(@Req() request: Request, @Res() response: Response): Promise<void> {
    const id = await this.owner(request, response); if (!id) return;
    try { response.json({ code: 0, desc: 'ok', data: await this.service.store.getProfile(id) }); }
    catch { jsonError(response, 503, 'storage_unavailable', 'Developer profile is unavailable'); }
  }

  @Put('profile')
  async save(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return;
    const id = await this.owner(request, response); if (!id) return;
    const input = record(value); const revision = input.expectedRevision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) { jsonError(response, 400, 'invalid_revision', 'A profile revision is required'); return; }
    try {
      const profile = await this.service.store.saveProfile(id, {
        displayName: typeof input.displayName === 'string' ? input.displayName : '', contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : '',
        contactPhone: typeof input.contactPhone === 'string' ? input.contactPhone : null, purpose: typeof input.purpose === 'string' ? input.purpose : '', expectedRevision: Number(revision),
      });
      response.json({ code: 0, desc: 'ok', data: profile });
    } catch (cause) {
      if (cause instanceof DeveloperReviewError) { jsonError(response, cause.code === 'review_conflict' ? 409 : cause.code === 'profile_locked' ? 423 : 400, cause.code, cause.code === 'profile_locked' ? 'Profile is locked during review' : 'Developer profile is invalid'); return; }
      jsonError(response, 503, 'storage_unavailable', 'Developer profile is unavailable');
    }
  }

  @Post('review/submit')
  @HttpCode(200)
  async submit(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return;
    const id = await this.owner(request, response); if (!id) return;
    const revision = record(value).expectedRevision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) { jsonError(response, 400, 'invalid_revision', 'A developer revision is required'); return; }
    try { response.json({ code: 0, desc: 'ok', data: await this.service.store.submitReview(id, Number(revision)) }); }
    catch (cause) {
      if (cause instanceof DeveloperReviewError) { jsonError(response, cause.code === 'review_conflict' ? 409 : cause.code === 'not_found' ? 404 : 400, cause.code, cause.code === 'profile_incomplete' ? 'Complete and verify the developer profile before submitting' : 'Developer review submission is not allowed'); return; }
      jsonError(response, 503, 'storage_unavailable', 'Developer review is unavailable');
    }
  }

  @Get('review/history')
  async history(@Req() request: Request, @Res() response: Response): Promise<void> {
    const id = await this.owner(request, response); if (!id) return;
    try { response.json({ code: 0, desc: 'ok', data: await this.service.store.listReviewHistory(id) }); }
    catch { jsonError(response, 503, 'storage_unavailable', 'Developer review history is unavailable'); }
  }

  @Post('profile/verification-email')
  async requestVerification(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return;
    const id = await this.owner(request, response); if (!id) return;
    const pending = this.service.requestEmailVerification(id);
    if (!pending) { jsonError(response, 503, 'email_delivery_unavailable', 'Email verification is not configured'); return; }
    try { const result = await pending; response.status(result === 'sent' ? 202 : 200).json({ code: 0, desc: 'ok', data: result }); }
    catch (cause) {
      if (cause instanceof EmailVerificationError) { jsonError(response, cause.message.includes('recently') ? 429 : cause.message.includes('profile') ? 409 : 503, 'verification_unavailable', cause.message); return; }
      jsonError(response, 503, 'email_delivery_unavailable', 'Email verification is unavailable');
    }
  }

  @Get('verify-email')
  verificationPage(@Query('token') token: unknown, @Res() response: Response): void {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !this.service.hasEmailVerification()) {
      response.status(400).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Email verification · MOONDROP</title><h1>Verification link is invalid or expired</h1></html>'); return;
    }
    response.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm email · MOONDROP</title><main><h1>Confirm your contact email</h1><p>Continue to verify the contact email on your developer profile.</p><form method="post" action="/api/v1/developer/verify-email"><input type="hidden" name="token" value="' + token + '"><button type="submit">Verify email</button></form></main></html>');
  }

  @Post('verify-email')
  async verifyEmail(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (request.header('origin') !== new URL(this.service.config.issuer).origin) { response.status(403).type('html').send('<h1>Request origin is not allowed</h1>'); return; }
    const token = record(value).token;
    if (typeof token !== 'string') { response.status(400).type('html').send('<h1>Verification link is invalid or expired</h1>'); return; }
    const pending = this.service.consumeEmailVerification(token);
    if (!pending) { response.status(400).type('html').send('<h1>Verification link is invalid or expired</h1>'); return; }
    try { const verified = await pending; response.status(verified ? 200 : 400).type('html').send('<h1>' + (verified ? 'Your contact email is verified.' : 'Verification link is invalid or expired.') + '</h1><a href="/developer">Developer center</a>'); }
    catch { response.status(503).type('html').send('<h1>Verification is temporarily unavailable</h1>'); }
  }

  @Get('moondrop/status')
  async moondropStatus(@Req() request: Request, @Res() response: Response): Promise<void> {
    const subject = await this.service.moondropSubject(request, response);
    if (!subject) { jsonError(response, 401, 'authentication_required', 'MOONDROP sign in is required'); return; }
    const account = await this.service.store.findByExternalIdentity('moondrop', subject);
    response.json({ code: 0, desc: 'ok', data: { bound: Boolean(account), account } });
  }

  @Post('moondrop/create')
  @HttpCode(200)
  async moondropCreate(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return;
    const subject = await this.service.moondropSubject(request, response);
    if (!subject) { jsonError(response, 401, 'authentication_required', 'MOONDROP sign in is required'); return; }
    try {
      const existing = await this.service.store.findByExternalIdentity('moondrop', subject);
      const account = existing ?? await this.service.store.createExternalAccount('moondrop', subject);
      setDeveloperSession(response, await this.service.establish(account.id), this.service.config.issuer.startsWith('https:'));
      response.status(existing ? 200 : 201).json({ code: 0, desc: 'ok', data: account });
    } catch { jsonError(response, 409, 'identity_conflict', 'MOONDROP account is already bound'); }
  }

  @Post('moondrop/bind')
  @HttpCode(200)
  async moondropBind(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return;
    const subject = await this.service.moondropSubject(request, response);
    if (!subject) { jsonError(response, 401, 'authentication_required', 'MOONDROP sign in is required'); return; }
    const input = record(value);
    try {
      const developerId = await this.service.login(String(input.email ?? ''), String(input.password ?? ''));
      await this.service.store.bindExternalIdentity(developerId, 'moondrop', subject);
      setDeveloperSession(response, await this.service.establish(developerId), this.service.config.issuer.startsWith('https:'));
      response.json({ code: 0, desc: 'ok', data: { developerId } });
    } catch { jsonError(response, 401, 'binding_failed', 'Developer credentials are invalid or the account is already bound'); }
  }
}
