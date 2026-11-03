import type { Express, NextFunction, Request, Response } from 'express';
import type Provider from 'oidc-provider';

const protocolPaths = new Set([
  '/.well-known/openid-configuration', '/.well-known/oauth-authorization-server',
  '/jwks', '/auth', '/authorize', '/token', '/me', '/userinfo', '/revoke', '/token/revocation', '/session/end',
]);

export function isProtocolPath(path: string): boolean {
  return protocolPaths.has(path) || [...protocolPaths].some((candidate) => path.startsWith(candidate + '/'));
}

export function mountProtocolMiddleware(app: Express, provider: Provider): void {
  const callback = provider.callback();
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!isProtocolPath(request.path)) { next(); return; }
    callback(request, response);
  });
}
