import { Provider, type AdapterFactory, type Configuration, type JWKS } from 'oidc-provider';

import { AccountService, claimsForScopes } from './accounts.js';
import type { ApplicationService } from './platform.js';

const ACCOUNT_ID_SEPARATOR = '.';
export const PORTAL_CLIENT_ID = 'dt-identity-portal';

export function accountHandle(uuid: string, fingerprint: string): string {
  return uuid + ACCOUNT_ID_SEPARATOR + fingerprint;
}

function parseAccountHandle(value: string): { uuid: string; fingerprint: string } | null {
  const separator = value.lastIndexOf(ACCOUNT_ID_SEPARATOR);
  if (separator < 1) return null;
  const uuid = value.slice(0, separator);
  const fingerprint = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) return null;
  return { uuid, fingerprint };
}

export function createProvider(
  issuer: string,
  adapter: AdapterFactory,
  accounts: AccountService,
  applications: ApplicationService,
  cookieKey: string,
  signingKeys: JWKS,
): Provider {
  const provider = new Provider(issuer, {
    adapter,
    clients: [{
      client_id: PORTAL_CLIENT_ID,
      client_name: 'DT Identity Portal',
      client_uri: issuer,
      redirect_uris: [issuer + '/portal/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      scope: 'openid profile email',
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      id_token_signed_response_alg: 'RS256',
    }],
    jwks: signingKeys,
    scopes: ['openid', 'profile', 'email'],
    findAccount: async (ctx, accountId) => {
      const handle = parseAccountHandle(accountId);
      const clientId = ctx.oidc.client?.clientId;
      if (!handle || !clientId) return undefined;

      const active = clientId === PORTAL_CLIENT_ID ? null : await applications.activeClient(clientId);
      if (clientId !== PORTAL_CLIENT_ID && !active) return undefined;
      const sector = active?.config.groupId ?? clientId;
      const identity = await accounts.resolve(handle.uuid, handle.fingerprint, sector);
      if (!identity) return undefined;

      return {
        accountId,
        claims: async (_use, scope) => ({
          sub: identity.sub,
          ...claimsForScopes(identity, new Set(scope.split(/\s+/).filter(Boolean))),
        }),
      };
    },
    clientBasedCORS: (_ctx, origin, client) => {
      if (client.tokenEndpointAuthMethod !== 'none' || client.applicationType !== 'web' || !client.clientUri) {
        return false;
      }
      try {
        return new URL(origin).origin === new URL(client.clientUri).origin;
      } catch {
        return false;
      }
    },
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    pkce: ({
      required: () => true,
      methods: ['S256'],
    } as unknown as NonNullable<Configuration['pkce']>),
    features: {
      devInteractions: { enabled: false },
      clientCredentials: { enabled: false },
      deviceFlow: { enabled: false },
      registration: { enabled: false },
      registrationManagement: { enabled: false },
      revocation: { enabled: true },
    },
    cookies: {
      keys: [cookieKey],
      long: { httpOnly: true, sameSite: 'lax', secure: issuer.startsWith('https:') },
      short: { httpOnly: true, sameSite: 'lax', secure: issuer.startsWith('https:') },
    },
    ttl: {
      AccessToken: 600,
      AuthorizationCode: 120,
      IdToken: 600,
      Interaction: 900,
      Session: 3600,
      Grant: 3600,
    },
  });

  return provider;
}
