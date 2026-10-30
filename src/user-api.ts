import { Router } from 'express';
import type Provider from 'oidc-provider';

import { AccountService, safeProfilePictureUrl } from './accounts.js';

function maskedEmail(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  return value.slice(0, 1) + '***' + value.slice(at);
}

export function createUserApiRouter(provider: Provider, accounts: AccountService, pictureBaseUrl: string | null = null): Router {
  const router = Router();
  router.get('/', async (request, response) => {
    try {
      const context = provider.createContext(request, response);
      const session = await provider.Session.get(context);
      const accountId = session.accountId;
      if (typeof accountId !== 'string') {
        return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
      }
      const separator = accountId.lastIndexOf('.');
      if (separator < 1) {
        return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
      }
      const uuid = accountId.slice(0, separator);
      const fingerprint = accountId.slice(separator + 1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) {
        return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
      }
      const identity = await accounts.resolve(uuid, fingerprint, 'user-profile-api');
      if (!identity) {
        return response.status(401).json({ code: 'authentication_required', desc: 'Sign in is required', data: null });
      }
      return response.json({
        code: 0,
        desc: 'ok',
        data: {
          nickname: identity.profile.nickname,
          email: maskedEmail(identity.profile.email),
          picture: safeProfilePictureUrl(identity.profile.picture, pictureBaseUrl),
        },
      });
    } catch {
      return response.status(503).json({ code: 'profile_unavailable', desc: 'Profile data is unavailable', data: null });
    }
  });
  return router;
}
