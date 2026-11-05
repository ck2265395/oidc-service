import { timingSafeEqual } from 'node:crypto';

import type { Request, Response } from 'express';

export function developerCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function developerWriteAllowed(request: Request, issuer: string): 'origin' | 'csrf' | true {
  if (request.header('origin') !== new URL(issuer).origin) return 'origin';
  const name = issuer.startsWith('https:') ? '__Host-dt-api-csrf' : 'dt-api-csrf';
  const fromCookie = developerCookie(request, name);
  const fromHeader = request.header('x-csrf-token');
  if (!fromCookie || !fromHeader) return 'csrf';
  const left = Buffer.from(fromCookie);
  const right = Buffer.from(fromHeader);
  return left.length === right.length && timingSafeEqual(left, right) ? true : 'csrf';
}

export function setDeveloperSession(response: Response, token: string, secure: boolean): void {
  response.cookie('md-developer', token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
}
