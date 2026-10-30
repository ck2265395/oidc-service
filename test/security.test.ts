import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  hashScryptPassword,
  verifyScryptPassword,
} from '../src/security.js';

const testKey = () => randomBytes(32).toString('base64url');

test('encrypts and decrypts client secrets with an authenticated envelope', () => {
  const key = testKey();
  const envelope = encryptSecret('client-secret-value', key);

  assert.equal(envelope.startsWith('v1.'), true);
  assert.equal(decryptSecret(envelope, key), 'client-secret-value');
});

test('rejects modified ciphertext and malformed encryption keys', () => {
  const key = testKey();
  const envelope = encryptSecret('sensitive-value', key);
  const [version, iv, ciphertext, tag] = envelope.split('.');

  const changedTag = `${tag[0] === 'a' ? 'b' : 'a'}${tag.slice(1)}`;
  assert.throws(() => decryptSecret(`${version}.${iv}.${ciphertext}.${changedTag}`, key));
  assert.throws(() => decryptSecret(envelope, testKey()));
  assert.throws(() => encryptSecret('value', 'short'));
});

test('constant-time comparison returns false for unequal values and lengths', () => {
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'else'), false);
  assert.equal(constantTimeEqual('short', 'longer'), false);
});

test('scrypt password hashes verify only the original password', () => {
  const hash = hashScryptPassword('long test password');

  assert.equal(verifyScryptPassword('long test password', hash), true);
  assert.equal(verifyScryptPassword('wrong password', hash), false);
  assert.equal(verifyScryptPassword('long test password', 'scrypt$999999999$8$1$x$y'), false);
  assert.equal(verifyScryptPassword('long test password', 'not-a-hash'), false);
});