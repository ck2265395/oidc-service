import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;

export class SecretDecryptionError extends Error {
  constructor() {
    super('Encrypted secret could not be authenticated');
    this.name = 'SecretDecryptionError';
  }
}

function decodeKey(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new TypeError('Encryption key must be a 32-byte base64url value');
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw new TypeError('Encryption key must be a 32-byte base64url value');
  }
  return key;
}

export function randomToken(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new RangeError('Token length must be between 16 and 128 bytes');
  }
  return randomBytes(bytes).toString('base64url');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  const size = Math.max(leftBytes.length, rightBytes.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  leftBytes.copy(paddedLeft);
  rightBytes.copy(paddedRight);

  return timingSafeEqual(paddedLeft, paddedRight) && leftBytes.length === rightBytes.length;
}

export function encryptSecret(plaintext: string, keyValue: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0 || plaintext.length > 16_384) {
    throw new TypeError('Secret value is invalid');
  }

  const key = decodeKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

export function decryptSecret(envelope: string, keyValue: string): string {
  try {
    const [version, ivEncoded, ciphertextEncoded, tagEncoded, extra] = envelope.split('.');
    if (version !== 'v1' || !ivEncoded || !ciphertextEncoded || !tagEncoded || extra !== undefined) {
      throw new Error('Invalid envelope');
    }

    const iv = Buffer.from(ivEncoded, 'base64url');
    const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
    const tag = Buffer.from(tagEncoded, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');

    const decipher = createDecipheriv('aes-256-gcm', decodeKey(keyValue), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptionError();
  }
}

export function hashScryptPassword(password: string): string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new TypeError('Password must contain between 12 and 1024 characters');
  }
  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  }).toString('base64url');

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

export function verifyScryptPassword(password: string, encodedHash: string): boolean {
  if (typeof password !== 'string' || password.length > 1024 || typeof encodedHash !== 'string') {
    return false;
  }

  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltValue = parts[4];
  const hashValue = parts[5];
  if (
    !Number.isSafeInteger(n) ||
    n < 16_384 ||
    n > 65_536 ||
    (n & (n - 1)) !== 0 ||
    !Number.isSafeInteger(r) ||
    r < 8 ||
    r > 8 ||
    !Number.isSafeInteger(p) ||
    p < 1 ||
    p > 4 ||
    !saltValue ||
    !hashValue ||
    !/^[A-Za-z0-9_-]+$/.test(saltValue) ||
    !/^[A-Za-z0-9_-]+$/.test(hashValue)
  ) {
    return false;
  }

  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(hashValue, 'base64url');
  if (
    salt.length !== 16 ||
    expected.length !== SCRYPT_KEY_BYTES ||
    salt.toString('base64url') !== saltValue ||
    expected.toString('base64url') !== hashValue
  ) {
    return false;
  }

  try {
    const actual = scryptSync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}