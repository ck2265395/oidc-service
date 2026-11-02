import { createHash } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type { Pool } from 'pg';

import type { ServiceConfig } from './config.js';
import { ApplicationGroupError, type ApplicationGroupService, type ApplicationGroupStatus } from './groups.js';
import { consoleMutationAllowed, readCookie } from './http-security.js';
import { ApplicationConflictError, type ApplicationService, type ApplicationStatus, type ReviewCommand } from './platform.js';
import { adminSessionAuthenticated } from './session-api.js';
import { DeveloperReviewError, type PostgresDeveloperStore } from './developer-store.js';
import type { DeveloperStatus } from './developer-identity.js';

function jsonError(response: Response, status: number, code: string, desc: string): void {
  response.status(status).json({ code, desc, data: null });
}
function positiveInteger(value: unknown, fallback: number, maximum = 10000): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : Number.NaN;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createAdminApiRouter(pool: Pool, config: ServiceConfig, applications: ApplicationService, groups: ApplicationGroupService, developers: PostgresDeveloperStore | null = null): Router {
  const router = Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(async (request, response, next) => {
    if (!await adminSessionAuthenticated(request, pool, config.issuer.startsWith('https:'))) {
      return jsonError(response, 401, 'authentication_required', 'Administrator sign in is required');
    }
    next();
  });
  const mutationAllowed = (request: Request, response: Response): boolean => {
    if (consoleMutationAllowed(request, config.issuer)) return true;
    jsonError(response, 403, 'csrf_denied', 'Request verification failed');
    return false;
  };

  router.post('/logout', async (request, response) => {
    if (!mutationAllowed(request, response)) return;
    const secure = config.issuer.startsWith('https:');
    const cookieName = secure ? '__Host-dt-admin' : 'dt-admin';
    const token = readCookie(request, cookieName);
    try {
      if (token) await pool.query('DELETE FROM admin_session WHERE session_hash = $1', [createHash('sha256').update(token, 'utf8').digest('hex')]);
      response.clearCookie(cookieName, { path: '/', httpOnly: true, secure, sameSite: 'strict' });
      response.json({ code: 0, desc: 'ok', data: { signedOut: true } });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Administrator sign out is unavailable'); }
  });

  router.get('/overview', async (_request, response) => {
    try {
      const [applicationCounts, groupCounts, recentAudit] = await Promise.all([
        pool.query<{ status: string; count: string }>('SELECT status, count(*)::text AS count FROM oidc_application GROUP BY status'),
        pool.query<{ status: string; count: string }>('SELECT status, count(*)::text AS count FROM oidc_application_group GROUP BY status'),
        pool.query<{ created_at: Date; action: string; outcome: string; actor_type: string }>('SELECT created_at, action, outcome, actor_type FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 8'),
      ]);
      response.json({ code: 0, desc: 'ok', data: {
        applications: Object.fromEntries(applicationCounts.rows.map((row) => [row.status, Number(row.count)])),
        groups: Object.fromEntries(groupCounts.rows.map((row) => [row.status, Number(row.count)])),
        recentAudit: recentAudit.rows.map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() })),
      } });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Overview data is unavailable'); }
  });

  router.get('/developers', async (request, response) => {
    if (!developers) return jsonError(response, 503, 'storage_unavailable', 'Developer review is unavailable');
    const page = positiveInteger(request.query.page, 1);
    const pageSize = positiveInteger(request.query.pageSize, 20, 100);
    const status = typeof request.query.status === 'string' ? request.query.status as DeveloperStatus : 'pending';
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || !['unsubmitted', 'pending', 'approved', 'rejected', 'disabled'].includes(status)) {
      return jsonError(response, 400, 'invalid_filter', 'Developer filters are invalid');
    }
    try { response.json({ code: 0, desc: 'ok', data: await developers.listForAdmin(status, page, pageSize) }); }
    catch { jsonError(response, 503, 'storage_unavailable', 'Developer data is unavailable'); }
  });

  router.get('/developers/:id', async (request, response) => {
    if (!developers) return jsonError(response, 503, 'storage_unavailable', 'Developer review is unavailable');
    try {
      const developer = await developers.getForAdmin(request.params.id);
      if (!developer) return jsonError(response, 404, 'not_found', 'Developer was not found');
      response.json({ code: 0, desc: 'ok', data: developer });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Developer data is unavailable'); }
  });

  router.post('/developers/:id/review', async (request, response) => {
    if (!mutationAllowed(request, response)) return;
    if (!developers) return jsonError(response, 503, 'storage_unavailable', 'Developer review is unavailable');
    const input = record(request.body);
    const action = String(input.action);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!['approve', 'reject', 'disable', 'restore'].includes(action) || !Number.isSafeInteger(input.expectedRevision) || ((action === 'reject' || action === 'disable') && !reason)) {
      return jsonError(response, 400, 'invalid_review', 'Review input is invalid');
    }
    try {
      const developer = await developers.reviewDeveloper(request.params.id, Number(input.expectedRevision), action as 'approve' | 'reject' | 'disable' | 'restore', `admin:${config.admin.username}`, reason || null);
      await pool.query(
        "INSERT INTO platform_audit (actor_type, actor_id, action, outcome, details) VALUES ('admin', $1, 'developer.review', 'success', $2::jsonb)",
        [`admin:${config.admin.username}`, JSON.stringify({ developerId: request.params.id, action })],
      );
      response.json({ code: 0, desc: 'ok', data: developer });
    } catch (error) {
      if (error instanceof DeveloperReviewError) {
        if (error.code === 'not_found') return jsonError(response, 404, 'not_found', 'Developer was not found');
        if (error.code === 'review_conflict') return jsonError(response, 409, 'review_conflict', 'Developer review changed; refresh and retry');
        return jsonError(response, 409, error.code, 'Developer review action is not allowed');
      }
      jsonError(response, 503, 'storage_unavailable', 'Developer review is unavailable');
    }
  });

  router.get('/applications', async (request, response) => {
    const page = positiveInteger(request.query.page, 1);
    const pageSize = positiveInteger(request.query.pageSize, 20, 100);
    const status = typeof request.query.status === 'string' ? request.query.status as ApplicationStatus : 'pending';
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || !['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(status)) {
      return jsonError(response, 400, 'invalid_filter', 'Application filters are invalid');
    }
    try { response.json({ code: 0, desc: 'ok', data: await applications.listForAdmin(page, pageSize, status) }); }
    catch { jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable'); }
  });

  router.get('/applications/:id', async (request, response) => {
    try {
      const application = await applications.getForAdmin(request.params.id);
      if (!application) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: application });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable'); }
  });

  router.post('/applications/:id/review', async (request, response) => {
    if (!mutationAllowed(request, response)) return;
    const input = record(request.body); const action = input.action; const expectedRevision = input.expectedRevision; const reason = input.reason;
    if (!['approve', 'reject', 'disable'].includes(String(action)) || !Number.isSafeInteger(expectedRevision) || (reason !== undefined && typeof reason !== 'string')) {
      return jsonError(response, 400, 'invalid_review', 'Review input is invalid');
    }
    const reviewerUuid = `admin:${config.admin.username}`;
    const command: ReviewCommand = action === 'approve' ? { action, reviewerUuid } : { action: action as 'reject' | 'disable', reviewerUuid, reason: typeof reason === 'string' ? reason : '' };
    try {
      const application = await applications.review(request.params.id, Number(expectedRevision), command);
      if (!application) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: application });
    } catch (error) {
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'review_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application review is unavailable');
    }
  });

  router.get('/groups', async (request, response) => {
    const page = positiveInteger(request.query.page, 1); const pageSize = positiveInteger(request.query.pageSize, 20, 100);
    const status = typeof request.query.status === 'string' ? request.query.status as ApplicationGroupStatus : 'pending';
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || !['pending', 'approved', 'rejected', 'disabled'].includes(status)) return jsonError(response, 400, 'invalid_filter', 'Group filters are invalid');
    try { response.json({ code: 0, desc: 'ok', data: await groups.listForAdmin(status, page, pageSize) }); }
    catch { jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable'); }
  });

  router.get('/groups/:id', async (request, response) => {
    try {
      const group = await groups.getForAdmin(request.params.id);
      if (!group) return jsonError(response, 404, 'not_found', 'Application group was not found');
      response.json({ code: 0, desc: 'ok', data: group });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable'); }
  });

  router.post('/groups/:id/review', async (request, response) => {
    if (!mutationAllowed(request, response)) return;
    const input = record(request.body); const action = input.action; const expectedRevision = input.expectedRevision; const reason = input.reason;
    if (!['approve', 'reject', 'disable'].includes(String(action)) || !Number.isSafeInteger(expectedRevision) || (reason !== undefined && typeof reason !== 'string')) return jsonError(response, 400, 'invalid_review', 'Review input is invalid');
    try {
      const group = await groups.review(request.params.id, Number(expectedRevision), action === 'approve'
        ? { action, reviewerUuid: `admin:${config.admin.username}` }
        : { action: action as 'reject' | 'disable', reviewerUuid: `admin:${config.admin.username}`, reason: typeof reason === 'string' ? reason : '' });
      if (!group) return jsonError(response, 404, 'not_found', 'Application group was not found');
      response.json({ code: 0, desc: 'ok', data: group });
    } catch (error) {
      if (error instanceof ApplicationGroupError) return jsonError(response, 409, 'review_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application group review is unavailable');
    }
  });

  router.get('/audit', async (request, response) => {
    const page = positiveInteger(request.query.page, 1);
    if (!Number.isSafeInteger(page)) return jsonError(response, 400, 'invalid_filter', 'Audit filters are invalid');
    try {
      const result = await pool.query('SELECT created_at, actor_type, actor_id, action, application_id, outcome, details FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $1', [(page - 1) * 50]);
      response.json({ code: 0, desc: 'ok', data: { page, list: result.rows } });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Audit data is unavailable'); }
  });

  router.get('/statistics', async (request, response) => {
    const days = positiveInteger(request.query.days, 7, 90);
    if (!Number.isSafeInteger(days)) return jsonError(response, 400, 'invalid_filter', 'Statistics filters are invalid');
    try {
      const result = await pool.query(
        "SELECT p.action, p.outcome, count(*)::int AS request_count, round(avg((p.details->>'durationMs')::numeric), 1)::float8 AS average_ms, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (p.details->>'durationMs')::double precision)::numeric, 1)::float8 AS p95_ms FROM platform_audit p WHERE p.action LIKE 'protocol.%' AND p.created_at >= now() - ($1::int * interval '1 day') GROUP BY p.action, p.outcome ORDER BY count(*) DESC LIMIT 200",
        [days],
      );
      response.json({ code: 0, desc: 'ok', data: { days, list: result.rows } });
    } catch { jsonError(response, 503, 'storage_unavailable', 'Statistics data is unavailable'); }
  });
  return router;
}
