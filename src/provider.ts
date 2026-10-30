import { Provider, type AdapterFactory, type Configuration, type JWKS } from 'oidc-provider';

import { AccountService, claimsForScopes } from './accounts.js';
import type { ApplicationService } from './platform.js';

const ACCOUNT_ID_SEPARATOR = '.';

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
    jwks: signingKeys,
    findAccount: async (ctx, accountId) => {
      const handle = parseAccountHandle(accountId);
      const clientId = ctx.oidc.client?.clientId;
      if (!handle || !clientId) return undefined;

      const active = await applications.activeClient(clientId);
      if (!active) return undefined;
      const sector = active.config.groupId ?? clientId;
      const identity = await accounts.resolve(handle.uuid, handle.fingerprint, sector);
      if (!identity) return undefined;

      return {
        accountId,
        claims: async (_use, scope) => ({
          sub: identity.sub,
          ...claimsForScopes(identity, new Set(scope.split(/\\s+/).filter(Boolean))),
        }),
      };
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
