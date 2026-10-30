import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, loadConfig } from '../src/config.js';

const validConfig = () => ({
  mode: 'test',
  issuer: 'https://identity.example.test',
  port: 3000,
  secrets: {
    cookie: 'c'.repeat(48),
    fingerprint: 'f'.repeat(48),
    subject: 's'.repeat(48),
    encryption: 'e'.repeat(48),
  },
  admin: {
    username: 'ops',
    passwordHash: 'scrypt$16384$8$1$salt$hash',
  },
  databases: {
    oidc: 'postgres://oidc:secret@localhost:5432/oidc_test',
    accounts: 'postgres://reader:secret@localhost:5432/accounts_test',
  },
  redisUrl: 'redis://localhost:6379/0',
});

test('accepts a complete test configuration', () => {
  const config = loadConfig(validConfig());

  assert.equal(config.mode, 'test');
  assert.equal(config.port, 3000);
  assert.equal(config.issuer, 'https://identity.example.test');
});

test('rejects non-object and array configuration values', () => {
  assert.throws(() => loadConfig(null), ConfigError);
  assert.throws(() => loadConfig([]), ConfigError);
  assert.throws(() => loadConfig('config'), ConfigError);
});

test('rejects weak or placeholder secrets', () => {
  const input = validConfig();
  input.secrets.cookie = 'replace-me';

  assert.throws(() => loadConfig(input), /secrets\.cookie/);
});

test('requires HTTPS issuer in production', () => {
  const input = validConfig();
  input.mode = 'production';
  input.issuer = 'http://identity.example.test';

  assert.throws(() => loadConfig(input), /HTTPS/);
});

test('rejects public or malformed database URLs', () => {
  const input = validConfig();
  input.databases.accounts = 'https://example.test/accounts';

  assert.throws(() => loadConfig(input), /databases\.accounts/);
});

test('does not permit a default or missing administrator credential', () => {
  const input = validConfig();
  input.admin.passwordHash = 'changeme';

  assert.throws(() => loadConfig(input), /admin\.passwordHash/);
});

test('rejects a non-integer port outside the TCP range', () => {
  const input = validConfig();
  input.port = 65536;

  assert.throws(() => loadConfig(input), /port/);
});