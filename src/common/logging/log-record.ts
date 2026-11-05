export type RouteKind = 'business' | 'protocol' | 'health' | 'static';

export interface HttpLogRecord {
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  routeKind: RouteKind;
  statusCode: number;
  durationMs: number;
  ip: string | null;
}

const protocolPaths = new Set([
  '/auth', '/token', '/me', '/jwks', '/token/revocation', '/session/end',
]);

export function classifyRoute(path: string): RouteKind {
  if (path.startsWith('/health/')) return 'health';
  if (path.startsWith('/.well-known/') || path.startsWith('/interaction/') || path.startsWith('/auth/') || protocolPaths.has(path)) return 'protocol';
  if (/\.[A-Za-z0-9]{1,8}$/.test(path)) return 'static';
  return 'business';
}

export function normalizeLogPath(path: string): string {
  if (/^\/interaction\/[^/]+(?:\/(?:login|consent))?$/.test(path)) return path.replace(/^\/interaction\/[^/]+/, '/interaction/:uid');
  if (/^\/auth\/[^/]+$/.test(path)) return '/auth/:uid';
  return path || '/';
}
