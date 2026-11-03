import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DeveloperReviewError } from '../../developer-store.js';
import { randomToken } from '../../security.js';
import { DeveloperService } from './developer.service.js';

function jsonError(response: Response, status: number, code: string, desc: string): void { response.status(status).json({ code, desc, data: null }); }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

@Controller('api/v1/developer')
export class DeveloperController {
  constructor(@Inject(DeveloperService) private readonly service: DeveloperService) {}

  private write(request: Request, response: Response): boolean {
    const allowed = this.service.writeAllowed(request);
    if (allowed === true) return true;
    jsonError(response, 403, allowed === 'origin' ? 'origin_denied' : 'csrf_denied', allowed === 'origin' ? 'Request origin is not allowed' : 'Request verification failed'); return false;
  }
  private async owner(request: Request, response: Response): Promise<string | null> {
    const developer = await this.service.authenticated(request);
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
      await this.service.establish(response, account.id);
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
      await this.service.establish(response, developerId);
      response.json({ code: 0, desc: 'ok', data: { developerId } });
    } catch { jsonError(response, 401, 'binding_failed', 'Developer credentials are invalid or the account is already bound'); }
  }
}
