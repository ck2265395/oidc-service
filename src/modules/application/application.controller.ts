import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ApplicationValidationError, type ClientType } from './domain/applications.js';
import { ApplicationGroupError } from './domain/groups.js';
import { ApplicationConflictError, type ApplicationRecord, type ApplicationStatus } from './application/application-management.service.js';
import { ApplicationApiService } from './application.service.js';

function error(response: Response, status: number, code: string, desc: string): void { response.status(status).json({ code, desc, data: null }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function integer(value: unknown, fallback: number): number { if (value === undefined) return fallback; return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : Number.NaN; }
function publicApplication(value: ApplicationRecord): Record<string, unknown> { return { id: value.id, clientId: value.clientId, type: value.type, revision: value.revision, status: value.status, draft: value.draft, approvedConfig: value.approvedConfig, approvedRevision: value.approvedRevision, lastReview: value.lastReview ? { action: value.lastReview.action, reason: value.lastReview.reason, reviewedAt: value.lastReview.reviewedAt } : null }; }

@Controller('api/v1/developer')
export class ApplicationController {
  constructor(@Inject(ApplicationApiService) private readonly service: ApplicationApiService) {}
  private write(request: Request, response: Response): boolean { const allowed = this.service.developer.writeAllowed(request); if (allowed === true) return true; error(response, 403, allowed === 'origin' ? 'origin_denied' : 'csrf_denied', allowed === 'origin' ? 'Request origin is not allowed' : 'Request verification failed'); return false; }
  private async developer(request: Request, response: Response) { const value = await this.service.developer.authenticated(request); if (!value) error(response, 401, 'authentication_required', 'Sign in is required'); return value; }

  @Get('applications')
  async list(@Query() query: Record<string, unknown>, @Req() request: Request, @Res() response: Response): Promise<void> {
    const developer = await this.developer(request, response); if (!developer) return;
    const page = integer(query.page, 1), pageSize = integer(query.pageSize, 20); const status = typeof query.status === 'string' ? query.status as ApplicationStatus : undefined;
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100 || (status && !['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(status))) { error(response, 400, 'invalid_pagination', 'Pagination or status is invalid'); return; }
    try { const result = await this.service.applications.listOwned(developer.id, page, pageSize, status); response.json({ code: 0, desc: 'ok', data: { total: result.total, list: result.list.map(publicApplication) } }); }
    catch { error(response, 503, 'storage_unavailable', 'Application data is unavailable'); }
  }

  @Post('applications')
  async create(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return;
    if (!await this.service.applications.getDeveloperProfile(developer.id)) { error(response, 409, 'profile_required', 'Register a developer profile first'); return; }
    const input = record(value); const type = input.type;
    if (typeof type !== 'string' || !['web', 'spa', 'native'].includes(type)) { error(response, 400, 'invalid_client_type', 'Client type is invalid'); return; }
    try { const created = await this.service.applications.createWithSecret(developer.id, type as ClientType, input.draft, developer.status); response.status(201).json({ code: 0, desc: 'ok', data: { application: publicApplication(created.record), clientSecret: created.clientSecret } }); }
    catch (cause) { if (cause instanceof ApplicationValidationError) error(response, 400, 'invalid_application', cause.message); else if (cause instanceof ApplicationConflictError) error(response, 409, 'application_conflict', cause.message); else error(response, 503, 'storage_unavailable', 'Application data is unavailable'); }
  }

  @Get('applications/:id')
  async get(@Param('id') id: string, @Req() request: Request, @Res() response: Response): Promise<void> { const developer = await this.developer(request, response); if (!developer) return; try { const app = await this.service.applications.getOwned(id, developer.id); if (!app) error(response, 404, 'not_found', 'Application was not found'); else response.json({ code: 0, desc: 'ok', data: publicApplication(app) }); } catch { error(response, 503, 'storage_unavailable', 'Application data is unavailable'); } }

  @Patch('applications/:id')
  async edit(@Param('id') id: string, @Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return; const input = record(value); if (!Number.isSafeInteger(input.expectedRevision) || typeof input.draft !== 'object') { error(response, 400, 'invalid_revision', 'A revision and application draft are required'); return; } try { const app = await this.service.applications.edit(id, developer.id, Number(input.expectedRevision), input.draft); if (!app) error(response, 404, 'not_found', 'Application was not found'); else response.json({ code: 0, desc: 'ok', data: publicApplication(app) }); } catch (cause) { if (cause instanceof ApplicationValidationError) error(response, 400, 'invalid_application', cause.message); else if (cause instanceof ApplicationConflictError) error(response, 409, 'application_conflict', cause.message); else error(response, 503, 'storage_unavailable', 'Application data is unavailable'); } }

  @Post('applications/:id/submit') @HttpCode(200)
  async submit(@Param('id') id: string, @Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { await this.revisionAction('submit', id, value, request, response); }
  @Post('applications/:id/rotate-secret') @HttpCode(200)
  async rotate(@Param('id') id: string, @Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { await this.revisionAction('rotate', id, value, request, response); }

  private async revisionAction(action: 'submit' | 'rotate', id: string, value: unknown, request: Request, response: Response): Promise<void> { if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return; const revision = record(value).expectedRevision; if (!Number.isSafeInteger(revision)) { error(response, 400, 'invalid_revision', 'A revision is required'); return; } try { if (action === 'submit') { const app = await this.service.applications.submit(id, developer.id, Number(revision)); if (!app) error(response, 404, 'not_found', 'Application was not found'); else response.json({ code: 0, desc: 'ok', data: publicApplication(app) }); } else { const result = await this.service.applications.rotateClientSecret(id, developer.id, Number(revision)); if (!result) error(response, 404, 'not_found', 'Application was not found'); else response.json({ code: 0, desc: 'ok', data: { clientSecret: result.clientSecret } }); } } catch (cause) { if (cause instanceof ApplicationConflictError) error(response, 409, 'application_conflict', cause.message); else error(response, 503, 'storage_unavailable', 'Application data is unavailable'); } }

  @Get('groups')
  async groups(@Query() query: Record<string, unknown>, @Req() request: Request, @Res() response: Response): Promise<void> { const developer = await this.developer(request, response); if (!developer) return; const page = integer(query.page, 1), pageSize = integer(query.pageSize, 20); if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100) { error(response, 400, 'invalid_pagination', 'Pagination is invalid'); return; } try { const result = await this.service.groups.listOwned(developer.id, page, pageSize); response.json({ code: 0, desc: 'ok', data: result }); } catch { error(response, 503, 'storage_unavailable', 'Application group data is unavailable'); } }

  @Post('groups')
  async createGroup(@Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return; if (!await this.service.applications.getDeveloperProfile(developer.id)) { error(response, 409, 'profile_required', 'Register a developer profile first'); return; } try { response.status(201).json({ code: 0, desc: 'ok', data: await this.service.groups.create(developer.id, record(value).displayName, developer.status) }); } catch (cause) { if (cause instanceof ApplicationGroupError) error(response, 400, 'invalid_group', cause.message); else error(response, 503, 'storage_unavailable', 'Application group data is unavailable'); } }

  @Put('groups/:id')
  async renameGroup(@Param('id') id: string, @Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return; const input = record(value); if (!Number.isSafeInteger(input.expectedRevision)) { error(response, 400, 'invalid_revision', 'A group revision is required'); return; } try { const group = await this.service.groups.rename(id, developer.id, Number(input.expectedRevision), input.displayName); if (!group) error(response, 404, 'not_found', 'Application group was not found'); else response.json({ code: 0, desc: 'ok', data: group }); } catch (cause) { if (cause instanceof ApplicationGroupError) error(response, 409, 'group_conflict', cause.message); else error(response, 503, 'storage_unavailable', 'Application group data is unavailable'); } }

  @Delete('groups/:id')
  async deleteGroup(@Param('id') id: string, @Body() value: unknown, @Req() request: Request, @Res() response: Response): Promise<void> { if (!this.write(request, response)) return; const developer = await this.developer(request, response); if (!developer) return; const revision = record(value).expectedRevision; if (!Number.isSafeInteger(revision)) { error(response, 400, 'invalid_revision', 'A group revision is required'); return; } try { if (!await this.service.groups.delete(id, developer.id, Number(revision))) error(response, 404, 'not_found', 'Application group was not found'); else response.json({ code: 0, desc: 'ok', data: { deleted: true } }); } catch (cause) { if (cause instanceof ApplicationGroupError) error(response, 409, 'group_conflict', cause.message); else error(response, 503, 'storage_unavailable', 'Application group data is unavailable'); } }
}
