import { createHmac, timingSafeEqual } from 'node:crypto';

import { Pool } from 'pg';

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

export class AccountDataError extends Error {
  constructor() {
    super('Account data is unavailable');
    this.name = 'AccountDataError';
  }
}

const SELECT_COLUMNS = '"uuid", "username", "password", "status", "nickname", "email", "profilepic"';

export function createAccountPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    application_name: 'dt-identity-service',
  });
}

/** PostgreSQL adapter that issues SELECT statements only. The DB role must also be read-only. */
export class PostgresAccountSource implements AccountSource {
  constructor(private readonly pool: Pool) {}

  async findByUuid(uuid: string): Promise<AccountRecord | null> {
    try {
      const result = await this.pool.query<AccountRecord>(
        `SELECT ${SELECT_COLUMNS} FROM "USER" WHERE "uuid" = $1 LIMIT 2`,
        [uuid],
      );
      if (result.rows.length > 1) throw new AccountDataError();
      return result.rows[0] ?? null;
    } catch {
      throw new AccountDataError();
    }
  }

  async lookup(type: LoginType, value: string): Promise<AccountRecord[]> {
    const column = type === 'username' ? '"username"' : '"email"';
    try {
      const result = await this.pool.query<AccountRecord>(
        `SELECT ${SELECT_COLUMNS} FROM "USER" WHERE ${column} = $1 LIMIT 2`,
        [value],
      );
      return result.rows;
    } catch {
      throw new AccountDataError();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function storedDigestIsValid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

function safeDigestEqual(expectedHex: string, storedHex: string): boolean {
  if (!storedDigestIsValid(storedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}

function credentialFingerprint(uuid: string, digest: string, key: string): string {
  return createHmac('sha256', key)
    .update(uuid, 'utf8')
    .update('\0')
    .update(digest, 'ascii')
    .digest('base64url');
}

function subjectForSector(uuid: string, sector: string, key: string): string {
  return createHmac('sha256', key)
    .update(sector, 'utf8')
    .update('\0')
    .update(uuid, 'utf8')
    .digest('base64url');
}

function isEnabled(record: AccountRecord): boolean {
  return record.status === 1 && typeof record.uuid === 'string' && record.uuid.length > 0;
}

export class AccountService {
  constructor(
    private readonly source: AccountSource,
    private readonly keys: AccountKeys,
  ) {}

  async authenticate(
    identifier: LoginIdentifier,
    password: unknown,
    sector = 'default',
    beforePasswordCheck?: (accountUuid: string | null) => Promise<void>,
  ): Promise<AccountIdentity | null> {
    if (
      !identifier ||
      !['username', 'email'].includes(identifier.type) ||
      typeof identifier.value !== 'string' ||
      identifier.value.length < 1 ||
      identifier.value.length > 254 ||
      identifier.value.trim() !== identifier.value ||
      typeof password !== 'string' ||
      password.length < 1 ||
      password.length > 1024 ||
      typeof sector !== 'string' ||
      sector.length < 1 ||
      sector.length > 255
    ) {
      return null;
    }

    const matches = await this.source.lookup(identifier.type, identifier.value);
    await beforePasswordCheck?.(matches.length === 1 ? matches[0]?.uuid ?? null : null);
    if (matches.length !== 1) return null;

    const account = matches[0];
    if (!account || !isEnabled(account) || !storedDigestIsValid(account.password)) return null;

    const candidate = createHmac('sha256', this.keys.legacyHmacKey)
      .update(password, 'utf8')
      .digest('hex');
    if (!safeDigestEqual(candidate, account.password)) return null;

    return this.toIdentity(account, sector);
  }

  async resolve(uuid: string, expectedFingerprint: string, sector = 'default'): Promise<AccountIdentity | null> {
    if (
      typeof uuid !== 'string' ||
      uuid.length < 1 ||
      uuid.length > 255 ||
      typeof expectedFingerprint !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(expectedFingerprint) ||
      typeof sector !== 'string' ||
      sector.length < 1 ||
      sector.length > 255
    ) {
      return null;
    }

    const account = await this.source.findByUuid(uuid);
    if (!account || !isEnabled(account) || !storedDigestIsValid(account.password)) return null;

    const currentFingerprint = credentialFingerprint(account.uuid, account.password, this.keys.fingerprintKey);
    const expected = Buffer.from(expectedFingerprint, 'base64url');
    const actual = Buffer.from(currentFingerprint, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    return this.toIdentity(account, sector);
  }

  private toIdentity(account: AccountRecord, sector: string): AccountIdentity {
    return {
      uuid: account.uuid,
      sub: subjectForSector(account.uuid, sector, this.keys.subjectKey),
      fingerprint: credentialFingerprint(account.uuid, account.password, this.keys.fingerprintKey),
      profile: {
        nickname: typeof account.nickname === 'string' ? account.nickname : null,
        email: typeof account.email === 'string' ? account.email : null,
        picture: typeof account.profilepic === 'string' ? account.profilepic : null,
      },
    };
  }
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
