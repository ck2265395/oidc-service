import { timingSafeEqual } from 'node:crypto';

import express, { type Request, type Response, Router } from 'express';
import type Provider from 'oidc-provider';

import { AccountService } from './accounts.js';
import { ApplicationValidationError, type ClientType } from './applications.js';
import { ApplicationConflictError, type ApplicationRecord, type ApplicationStatus, ApplicationService } from './platform.js';
import { ApplicationGroupError, type ApplicationGroupService } from './groups.js';
import { DeveloperEmailVerification, EmailVerificationError } from './email-verification.js';

interface Body {
  [key: string]: unknown;
}

function body(request: Request): Body {
  return typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)
    ? request.body as Body
    : {};
}

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function csrfCookieName(secure: boolean): string {
  return secure ? '__Host-dt-api-csrf' : 'dt-api-csrf';
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function csrfValid(request: Request, secure: boolean): boolean {
  const cookie = readCookie(request, csrfCookieName(secure));
  const header = request.header('x-csrf-token');
  if (!cookie || !header) return false;
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonError(response: Response, status: number, code: string, desc: string): void {
  response.status(status).json({ code, desc, data: null });
}

function publicApplication(record: ApplicationRecord): Record<string, unknown> {
  return {
    id: record.id,
    clientId: record.clientId,
    type: record.type,
    revision: record.revision,
    status: record.status,
    draft: record.draft,
    approvedConfig: record.approvedConfig,
    approvedRevision: record.approvedRevision,
    lastReview: record.lastReview
      ? { action: record.lastReview.action, reason: record.lastReview.reason, reviewedAt: record.lastReview.reviewedAt }
      : null,
  };
}

export function createDeveloperRouter(
  provider: Provider,
  accounts: AccountService,
  applications: ApplicationService,
  groups: ApplicationGroupService,
  issuer: string,
  secureCookies: boolean,
  emailVerification: DeveloperEmailVerification | null = null,
): Router {
  const router = Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 4 }));

  const authenticatedOwner = async (request: Request, response: Response): Promise<string | null> => {
    try {
      const context = provider.createContext(request, response);
      const session = await provider.Session.get(context);
      const accountId = session.accountId;
      if (typeof accountId !== 'string') return null;
      const separator = accountId.lastIndexOf('.');
      if (separator < 1) return null;
      const uuid = accountId.slice(0, separator);
      const fingerprint = accountId.slice(separator + 1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) return null;
      const identity = await accounts.resolve(uuid, fingerprint, 'developer-portal');
      return identity?.uuid ?? null;
    } catch {
      return null;
    }
  };

  const ensureWriteRequest = (request: Request, response: Response): boolean => {
    const origin = request.header('origin');
    if (origin !== new URL(issuer).origin) {
      jsonError(response, 403, 'origin_denied', 'Request origin is not allowed');
      return false;
    }
    if (!csrfValid(request, secureCookies)) {
      jsonError(response, 403, 'csrf_denied', 'Request verification failed');
      return false;
    }
    return true;
  };

  router.get('/csrf', async (request, response) => {
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const token = cryptoRandomToken();
    response.cookie(csrfCookieName(secureCookies), token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookies,
      path: '/',
      maxAge: 30 * 60 * 1000,
    });
    response.json({ code: 0, desc: 'ok', data: { token } });
  });

  router.get('/profile', async (request, response) => {
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    try {
      const profile = await applications.getDeveloperProfile(ownerUuid);
      response.json({ code: 0, desc: 'ok', data: profile });
    } catch {
      jsonError(response, 503, 'storage_unavailable', 'Developer profile is unavailable');
    }
  });

  router.put('/profile', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const input = body(request);
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) {
      return jsonError(response, 400, 'invalid_revision', 'A profile revision is required');
    }
    try {
      const profile = await applications.saveDeveloperProfile(ownerUuid, {
        displayName: input.displayName,
        contactEmail: input.contactEmail,
      }, Number(input.expectedRevision));
      response.json({ code: 0, desc: 'ok', data: profile });
    } catch (error) {
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'profile_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Developer profile is unavailable');
    }
  });

  router.post('/profile/verification-email', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    if (!emailVerification) return jsonError(response, 503, 'email_delivery_unavailable', 'Email verification is not configured');
    try {
      const result = await emailVerification.request(ownerUuid);
      response.status(result === 'sent' ? 202 : 200).json({ code: 0, desc: 'ok', data: result });
    } catch (error) {
      if (error instanceof EmailVerificationError) {
        const status = error.message.includes('recently') ? 429 : error.message.includes('profile') ? 409 : 503;
        return jsonError(response, status, 'verification_unavailable', error.message);
      }
      jsonError(response, 503, 'email_delivery_unavailable', 'Email verification is unavailable');
    }
  });

  router.get('/verify-email', (request, response) => {
    const token = scalar(request.query.token);
    if (!emailVerification || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return response.status(400).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Email verification · DT Identity</title><h1>Verification link is invalid or expired</h1></html>');
    }
    response.type('html').send(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Confirm email · DT Identity</title><main><h1>Confirm your contact email</h1>' +
      '<p>Continue to verify the contact email on your developer profile.</p>' +
      '<form method="post" action="/api/v1/developer/verify-email"><input type="hidden" name="token" value="' + token +
      '"><button type="submit">Verify email</button></form></main></html>',
    );
  });

  router.post('/verify-email', async (request, response) => {
    if (request.header('origin') !== new URL(issuer).origin) {
      return response.status(403).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Denied · DT Identity</title><h1>Request origin is not allowed</h1></html>');
    }
    const token = scalar(body(request).token);
    if (!emailVerification || !token) {
      return response.status(400).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Email verification · DT Identity</title><h1>Verification link is invalid or expired</h1></html>');
    }
    try {
      const verified = await emailVerification.consume(token);
      const title = verified ? 'Email verified' : 'Verification link is invalid or expired';
      const heading = verified ? 'Your contact email is verified.' : 'Verification link is invalid or expired.';
      response.status(verified ? 200 : 400).type('html').send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + title + ' · DT Identity</title><main><h1>' + heading +
        '</h1><p>You may close this page and return to the developer center.</p><a href="/developer">Developer center</a></main></html>',
      );
    } catch {
      response.status(503).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable · DT Identity</title><h1>Verification is temporarily unavailable</h1></html>');
    }
  });

  router.get('/groups', async (request, response) => {
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const page = positiveInteger(request.query.page, 1);
    const pageSize = positiveInteger(request.query.pageSize, 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return jsonError(response, 400, 'invalid_pagination', 'Pagination is invalid');
    }
    try {
      const result = await groups.listOwned(ownerUuid, page, pageSize);
      response.json({ code: 0, desc: 'ok', data: { total: result.total, list: result.list } });
    } catch {
      jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable');
    }
  });

  router.post('/groups', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const profile = await applications.getDeveloperProfile(ownerUuid);
    if (!profile) return jsonError(response, 409, 'profile_required', 'Register a developer profile first');
    try {
      const group = await groups.create(ownerUuid, body(request).displayName);
      response.status(201).json({ code: 0, desc: 'ok', data: group });
    } catch (error) {
      if (error instanceof ApplicationGroupError) return jsonError(response, 400, 'invalid_group', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable');
    }
  });

  router.delete('/groups/:id', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const revision = body(request).expectedRevision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      return jsonError(response, 400, 'invalid_revision', 'A group revision is required');
    }
    try {
      const deleted = await groups.delete(request.params.id, ownerUuid, Number(revision));
      if (!deleted) return jsonError(response, 404, 'not_found', 'Application group was not found');
      response.json({ code: 0, desc: 'ok', data: { deleted: true } });
    } catch (error) {
      if (error instanceof ApplicationGroupError) return jsonError(response, 409, 'group_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable');
    }
  });

  router.put('/groups/:id', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const input = body(request);
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
      return jsonError(response, 400, 'invalid_revision', 'A group revision is required');
    }
    try {
      const group = await groups.rename(
        request.params.id,
        ownerUuid,
        Number(input.expectedRevision),
        input.displayName,
      );
      if (!group) return jsonError(response, 404, 'not_found', 'Application group was not found');
      response.json({ code: 0, desc: 'ok', data: group });
    } catch (error) {
      if (error instanceof ApplicationGroupError) {
        return jsonError(response, 409, 'group_conflict', error.message);
      }
      jsonError(response, 503, 'storage_unavailable', 'Application group data is unavailable');
    }
  });

  router.get('/applications', async (request, response) => {
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const page = positiveInteger(request.query.page, 1);
    const pageSize = positiveInteger(request.query.pageSize, 20);
    const statusValue = request.query.status;
    const status = typeof statusValue === 'string' ? statusValue as ApplicationStatus : undefined;
    if (
      !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      (status !== undefined && !['draft', 'pending', 'rejected', 'approved', 'disabled'].includes(status))
    ) return jsonError(response, 400, 'invalid_pagination', 'Pagination or status is invalid');
    try {
      const result = await applications.listOwned(ownerUuid, page, pageSize, status);
      response.json({
        code: 0,
        desc: 'ok',
        data: { total: result.total, list: result.list.map(publicApplication) },
      });
    } catch {
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  router.post('/applications', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const profile = await applications.getDeveloperProfile(ownerUuid);
    if (!profile) return jsonError(response, 409, 'profile_required', 'Register a developer profile first');
    const input = body(request);
    const type = scalar(input.type);
    if (!type || !['web', 'spa', 'native'].includes(type)) {
      return jsonError(response, 400, 'invalid_client_type', 'Client type is invalid');
    }
    try {
      const created = await applications.createWithSecret(ownerUuid, type as ClientType, input.draft);
      response.status(201).json({
        code: 0,
        desc: 'ok',
        data: { application: publicApplication(created.record), clientSecret: created.clientSecret },
      });
    } catch (error) {
      if (error instanceof ApplicationValidationError) return jsonError(response, 400, 'invalid_application', error.message);
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'application_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  router.get('/applications/:id', async (request, response) => {
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    try {
      const record = await applications.getOwned(request.params.id, ownerUuid);
      if (!record) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: publicApplication(record) });
    } catch {
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  router.patch('/applications/:id', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const input = body(request);
    if (!Number.isSafeInteger(input.expectedRevision) || typeof input.draft !== 'object') {
      return jsonError(response, 400, 'invalid_revision', 'A revision and application draft are required');
    }
    try {
      const record = await applications.edit(request.params.id, ownerUuid, Number(input.expectedRevision), input.draft);
      if (!record) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: publicApplication(record) });
    } catch (error) {
      if (error instanceof ApplicationValidationError) return jsonError(response, 400, 'invalid_application', error.message);
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'application_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  router.post('/applications/:id/submit', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const revision = body(request).expectedRevision;
    if (!Number.isSafeInteger(revision)) return jsonError(response, 400, 'invalid_revision', 'A revision is required');
    try {
      const record = await applications.submit(request.params.id, ownerUuid, Number(revision));
      if (!record) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: publicApplication(record) });
    } catch (error) {
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'application_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  router.post('/applications/:id/rotate-secret', async (request, response) => {
    if (!ensureWriteRequest(request, response)) return;
    const ownerUuid = await authenticatedOwner(request, response);
    if (!ownerUuid) return jsonError(response, 401, 'authentication_required', 'Sign in is required');
    const revision = body(request).expectedRevision;
    if (!Number.isSafeInteger(revision)) return jsonError(response, 400, 'invalid_revision', 'A revision is required');
    try {
      const result = await applications.rotateClientSecret(request.params.id, ownerUuid, Number(revision));
      if (!result) return jsonError(response, 404, 'not_found', 'Application was not found');
      response.json({ code: 0, desc: 'ok', data: { clientSecret: result.clientSecret } });
    } catch (error) {
      if (error instanceof ApplicationConflictError) return jsonError(response, 409, 'application_conflict', error.message);
      jsonError(response, 503, 'storage_unavailable', 'Application data is unavailable');
    }
  });

  return router;
}

function cryptoRandomToken(): string {
  return Buffer.from(cryptoRandomBytes(32)).toString('base64url');
}

import { randomBytes as cryptoRandomBytes } from 'node:crypto';
