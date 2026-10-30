import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApplicationValidationError,
  validateApplicationDraft,
} from '../src/applications.js';

const draft = (overrides: Record<string, unknown> = {}) => ({
  name: 'Demo client',
  description: 'A test application',
  purpose: 'Sign in to the test application',
  homepageUrl: 'https://client.example.invalid',
  privacyUrl: 'https://client.example.invalid/privacy',
  termsUrl: 'https://client.example.invalid/terms',
  iconUrl: null,
  redirectUris: ['https://client.example.invalid/callback'],
  postLogoutRedirectUris: ['https://client.example.invalid/logout'],
  scopes: ['openid', 'profile'],
  groupId: null,
  ...overrides,
});

test('accepts a complete web client draft and preserves exact callbacks', () => {
  const result = validateApplicationDraft(draft(), 'web', 'production');

  assert.equal(result.name, 'Demo client');
  assert.deepEqual(result.redirectUris, ['https://client.example.invalid/callback']);
  assert.deepEqual(result.scopes, ['openid', 'profile']);
});

test('requires all identity and policy URLs to use HTTPS', () => {
  assert.throws(
    () => validateApplicationDraft(draft({ privacyUrl: 'http://client.example.invalid/privacy' }), 'web', 'production'),
    ApplicationValidationError,
  );
});

test('rejects wildcard, fragment, credentials, and duplicate callback URLs', () => {
  for (const uri of [
    'https://client.example.invalid/*',
    'https://client.example.invalid/callback#fragment',
    'https://user:pass@client.example.invalid/callback',
  ]) {
    assert.throws(
      () => validateApplicationDraft(draft({ redirectUris: [uri] }), 'web', 'production'),
      ApplicationValidationError,
    );
  }

  assert.throws(
    () => validateApplicationDraft(draft({ redirectUris: [
      'https://client.example.invalid/callback',
      'https://client.example.invalid/callback',
    ] }), 'web', 'production'),
    /duplicate/i,
  );
});

test('allows HTTP only for local development callbacks', () => {
  const result = validateApplicationDraft(
    draft({ redirectUris: ['http://127.0.0.1:43123/callback'] }),
    'web',
    'development',
  );

  assert.deepEqual(result.redirectUris, ['http://127.0.0.1:43123/callback']);
  assert.throws(
    () => validateApplicationDraft(draft({ redirectUris: ['http://client.example.invalid/callback'] }), 'web', 'development'),
    ApplicationValidationError,
  );
});

test('accepts reverse-domain private URI schemes only for native clients', () => {
  const native = validateApplicationDraft(
    draft({ redirectUris: ['com.example.mobile:/oauth2redirect'] }),
    'native',
    'production',
  );

  assert.equal(native.redirectUris[0], 'com.example.mobile:/oauth2redirect');
  assert.throws(
    () => validateApplicationDraft(draft({ redirectUris: ['com.example.mobile:/oauth2redirect'] }), 'spa', 'production'),
    ApplicationValidationError,
  );
});

test('rejects unsupported scopes and requires openid', () => {
  assert.throws(
    () => validateApplicationDraft(draft({ scopes: ['profile'] }), 'web', 'production'),
    /openid/i,
  );
  assert.throws(
    () => validateApplicationDraft(draft({ scopes: ['openid', 'offline_access'] }), 'web', 'production'),
    ApplicationValidationError,
  );
});