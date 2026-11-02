import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;

export type DeveloperStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected' | 'disabled';
export type DeveloperReviewAction = 'submit' | 'approve' | 'reject' | 'disable' | 'restore';

export interface PasswordDigest {
  version: 'scrypt-v1';
  n: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

export interface DeveloperReview {
  action: DeveloperReviewAction;
  reason: string | null;
  reviewerId: string | null;
  reviewedAt: string;
}

export interface DeveloperAccount {
  id: string;
  status: DeveloperStatus;
  revision: number;
  lastReview: DeveloperReview | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

export interface DeveloperProfile {
  developerId: string;
  displayName: string;
  contactEmail: string;
  contactEmailVerified: boolean;
  contactPhone: string | null;
  purpose: string;
  revision: number;
}

export function normalizeDeveloperEmail(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Developer email is invalid');
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) throw new TypeError('Developer email is invalid');
  return normalized;
}

function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new TypeError('Developer password must contain between 10 and 128 characters');
  }
  const groups = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  if (groups.filter(Boolean).length < 3) throw new TypeError('Developer password must use at least three character groups');
}

export async function hashDeveloperPassword(password: string): Promise<PasswordDigest> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  }) as Buffer;
  return {
    version: 'scrypt-v1',
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString('base64url'),
    hash: derived.toString('base64url'),
  };
}

export async function verifyDeveloperPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  if (
    typeof password !== 'string' || password.length > 128 ||
    digest.version !== 'scrypt-v1' || digest.n !== SCRYPT_N || digest.r !== SCRYPT_R || digest.p !== SCRYPT_P ||
    !/^[A-Za-z0-9_-]{22}$/.test(digest.salt) || !/^[A-Za-z0-9_-]{86}$/.test(digest.hash)
  ) return false;
  try {
    const salt = Buffer.from(digest.salt, 'base64url');
    const expected = Buffer.from(digest.hash, 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_BYTES) return false;
    const actual = await scrypt(password, salt, SCRYPT_BYTES, {
      N: digest.n,
      r: digest.r,
      p: digest.p,
      maxmem: 64 * 1024 * 1024,
    }) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function assertDeveloperTransition(from: DeveloperStatus, action: DeveloperReviewAction): DeveloperStatus {
  const target = (
    from === 'unsubmitted' && action === 'submit' ? 'pending' :
    from === 'rejected' && action === 'submit' ? 'pending' :
    from === 'pending' && action === 'approve' ? 'approved' :
    from === 'pending' && action === 'reject' ? 'rejected' :
    from !== 'disabled' && action === 'disable' ? 'disabled' :
    from === 'disabled' && action === 'restore' ? 'unsubmitted' : null
  ) satisfies DeveloperStatus | null;
  if (!target) throw new TypeError(`Developer transition ${from}:${action} is not allowed`);
  return target;
}
