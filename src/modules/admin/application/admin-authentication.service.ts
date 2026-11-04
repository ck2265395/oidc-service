import { randomBytes, scryptSync } from 'node:crypto';

import { verifyScryptPassword } from '../../../common/security/security.js';
import type { AdminCredential, AdminPrincipal } from '../domain/administrator.js';

const N = 16_384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;

export function hashAdminPassword(password: string): string {
  if (typeof password !== 'string' || password.length < 6 || password.length > 1024) throw new TypeError('Administrator password must contain between 6 and 1024 characters');
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64url'), digest.toString('base64url')].join('$');
}

const DUMMY_HASH = hashAdminPassword('invalid-admin-password');

interface CredentialRepository { findCredential(username: string): Promise<AdminCredential | null>; }

export class AdminAuthenticationService {
  constructor(private readonly repository: CredentialRepository) {}
  async login(username: unknown, password: unknown): Promise<AdminPrincipal | null> {
    const validInput = typeof username === 'string' && typeof password === 'string' && username.length <= 128 && password.length <= 1024;
    const credential = validInput ? await this.repository.findCredential(username) : null;
    const validPassword = verifyScryptPassword(typeof password === 'string' ? password : '', credential?.passwordHash ?? DUMMY_HASH);
    return validPassword && credential?.status === 'active' ? credential.principal : null;
  }
}
