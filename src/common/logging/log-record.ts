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
  if (path === '/health' || path === '/ready') return 'health';
  if (path.startsWith('/.well-known/') || protocolPaths.has(path)) return 'protocol';
  if (/\.[A-Za-z0-9]{1,8}$/.test(path)) return 'static';
  return 'business';
}
