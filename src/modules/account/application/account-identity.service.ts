import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AccountIdentity, AccountKeys, AccountRecord, AccountSource, LoginIdentifier } from '../domain/accounts.js';

function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value); }
function fingerprint(uuid: string, digest: string, key: string): string { return createHmac('sha256', key).update(uuid).update('\0').update(digest).digest('base64url'); }
function subject(uuid: string, sector: string, key: string): string { return createHmac('sha256', key).update(sector).update('\0').update(uuid).digest('base64url'); }

@Injectable()
export class AccountService {
  constructor(private readonly source: AccountSource, private readonly keys: AccountKeys) {}
  async authenticate(identifier: LoginIdentifier, password: unknown, sector = 'default', beforePasswordCheck?: (accountUuid: string | null) => Promise<void>): Promise<AccountIdentity | null> {
    if (!identifier || !['username','email'].includes(identifier.type) || typeof identifier.value !== 'string' || !identifier.value || identifier.value.length > 254 || identifier.value.trim() !== identifier.value || typeof password !== 'string' || !password || password.length > 1024 || !sector || sector.length > 255) return null;
    const matches = await this.source.lookup(identifier.type, identifier.value); await beforePasswordCheck?.(matches.length === 1 ? matches[0]?.uuid ?? null : null);
    const account = matches.length === 1 ? matches[0] : null; if (!account || account.status !== 1 || !account.uuid || !validDigest(account.password)) return null;
    const candidate = createHmac('sha256', this.keys.legacyHmacKey).update(password).digest('base64');
    const expected = Buffer.from(candidate, 'base64'), stored = Buffer.from(account.password, 'base64'); if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) return null;
    return this.identity(account, sector);
  }
  async resolve(uuid: string, expectedFingerprint: string, sector = 'default'): Promise<AccountIdentity | null> {
    if (!uuid || uuid.length > 255 || !/^[A-Za-z0-9_-]{43}$/.test(expectedFingerprint) || !sector || sector.length > 255) return null;
    const account = await this.source.findByUuid(uuid); if (!account || account.status !== 1 || !validDigest(account.password)) return null;
    const actual = Buffer.from(fingerprint(account.uuid, account.password, this.keys.fingerprintKey), 'base64url'), expected = Buffer.from(expectedFingerprint, 'base64url');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? this.identity(account, sector) : null;
  }
  private identity(account: AccountRecord, sector: string): AccountIdentity { return { uuid: account.uuid, sub: subject(account.uuid, sector, this.keys.subjectKey), fingerprint: fingerprint(account.uuid, account.password, this.keys.fingerprintKey), profile: { nickname: typeof account.nickname === 'string' ? account.nickname : null, email: typeof account.email === 'string' ? account.email : null, picture: typeof account.profilepic === 'string' ? account.profilepic : null } }; }
}
