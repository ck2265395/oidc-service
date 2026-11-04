import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { Request, Response } from 'express';

export const CONSOLE_CSRF_COOKIE = 'dt-console-csrf';

export function randomCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function readCookie(request: Request, name: string): string | null {
  for (const entry of (request.headers.cookie ?? '').split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function setConsoleCsrf(response: Response, secure: boolean): string {
  const token = randomCsrfToken();
  response.cookie(CONSOLE_CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: 30 * 60 * 1000,
  });
  return token;
}

export function consoleMutationAllowed(request: Request, issuer: string): boolean {
  const expected = new URL(issuer).origin;
  const origin = request.header('origin');
  const sameOrigin = origin === expected || (origin === 'null' && request.header('sec-fetch-site') === 'same-origin');
  if (!sameOrigin) return false;
  const cookie = readCookie(request, CONSOLE_CSRF_COOKIE);
  const header = request.header('x-csrf-token');
  if (!cookie || !header) return false;
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}
