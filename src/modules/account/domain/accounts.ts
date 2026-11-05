export interface AccountRecord {
  uuid: string;
  username: string;
  password: string;
  status: number;
  nickname: string | null;
  email: string | null;
  profilepic: string | null;
}

export type LoginType = 'username' | 'email';
export type LoginIdentifier = { type: LoginType; value: unknown };

export interface AccountSource {
  findByUuid(uuid: string): Promise<AccountRecord | null>;
  lookup(type: LoginType, value: string): Promise<AccountRecord[]>;
}

export interface AccountKeys {
  legacyHmacKey: string;
  fingerprintKey: string;
  subjectKey: string;
}

export interface AccountIdentity {
  /** Internal platform handle. Never return this field from an OIDC claim. */
  uuid: string;
  /** Pairwise subject for the supplied sector. */
  sub: string;
  /** Internal credential version marker. Never send to a client. */
  fingerprint: string;
  profile: {
    nickname: string | null;
    email: string | null;
    picture: string | null;
  };
}

export function claimsForScopes(
  identity: AccountIdentity,
  scopes: ReadonlySet<string>,
): Record<string, string> {
  const claims: Record<string, string> = {};
  if (scopes.has('profile')) {
    if (identity.profile.nickname) claims.name = identity.profile.nickname;
    if (identity.profile.picture) claims.picture = identity.profile.picture;
  }
  if (scopes.has('email') && identity.profile.email) {
    claims.email = identity.profile.email;
  }
  return claims;
}
export function safeProfilePictureUrl(value: string | null, baseUrl: string | null): string | null {
  if (!value || value.length > 1024 || value.trim() !== value) return null;
  try {
    const absolute = new URL(value);
    if (absolute.protocol !== 'https:' || !absolute.hostname || absolute.username || absolute.password) return null;
    return absolute.toString();
  } catch {
    if (!baseUrl || value.startsWith('//') || value.includes(String.fromCharCode(92)) || value.includes('?') || value.includes('#')) return null;
    let path = value;
    while (path.startsWith('/')) path = path.slice(1);
    if (!path || path.split('/').some((part) => part === '.' || part === '..')) return null;
    try {
      const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
      const picture = new URL(path, base);
      if (picture.origin !== base.origin || !picture.pathname.startsWith(base.pathname)) return null;
      return picture.toString();
    } catch {
      return null;
    }
  }
}
