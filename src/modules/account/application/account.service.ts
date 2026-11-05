import { Injectable } from '@nestjs/common';

import type { AccountIdentity } from '../domain/accounts.js';
import { safeProfilePictureUrl } from '../domain/accounts.js';
import type { ServiceConfig } from '../../../infrastructure/config/config.schema.js';

export interface AccountResolutionPort {
  resolve(uuid: string, fingerprint: string, sector?: string): Promise<AccountIdentity | null>;
}

export interface ProviderGrantPort {
  revokeGrant(id: string, accountId: string): Promise<{ clientId: string | null } | null>;
}

export interface AuthorizationView {
  id: string; clientId: string | null; name: string; scopes: string[]; status: string; authorizedAt: string;
}

export interface AccountRepositoryPort {
  listAuthorizations(accountId: string): Promise<AuthorizationView[]>;
  authorizationOwned(id: string, accountId: string): Promise<boolean>;
  recordRevocation(uuid: string, clientId: string | null): Promise<void>;
}

function maskedEmail(value: string | null): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  return at > 0 ? value.slice(0, 1) + '***' + value.slice(at) : '***';
}

@Injectable()
export class AccountApplicationService {
  constructor(
    private readonly resolver: AccountResolutionPort,
    private readonly repository: AccountRepositoryPort,
    private readonly sessions: ProviderGrantPort,
    private readonly config: ServiceConfig,
  ) {}

  async identity(accountId: string | null, sector: string): Promise<AccountIdentity | null> {
    if (!accountId) return null;
    const separator = accountId.lastIndexOf('.');
    if (separator < 1) return null;
    const uuid = accountId.slice(0, separator); const fingerprint = accountId.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) return null;
    return this.resolver.resolve(uuid, fingerprint, sector);
  }

  profile(identity: AccountIdentity): Record<string, unknown> {
    return { nickname: identity.profile.nickname, email: maskedEmail(identity.profile.email), picture: safeProfilePictureUrl(identity.profile.picture, this.config.profilePictureBaseUrl) };
  }

  accountSummary(identity: AccountIdentity): Record<string, unknown> {
    return { uuid: identity.uuid, ...this.profile(identity) };
  }

  listAuthorizations(accountId: string): Promise<AuthorizationView[]> { return this.repository.listAuthorizations(accountId); }

  async revokeAuthorization(id: string, accountId: string): Promise<boolean> {
    if (!id || id.length > 128 || !await this.repository.authorizationOwned(id, accountId)) return false;
    const grant = await this.sessions.revokeGrant(id, accountId);
    if (!grant) return false;
    const separator = accountId.lastIndexOf('.');
    await this.repository.recordRevocation(accountId.slice(0, separator), grant.clientId);
    return true;
  }

  get settings(): ServiceConfig { return this.config; }
}
