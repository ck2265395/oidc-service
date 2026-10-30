import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { ConfigError, loadConfig } from '../src/config.js';

const testSecret = () => randomBytes(32).toString('base64url');

const validConfig = () => ({
  mode: 'test',
  issuer: 'https://identity.example.test',
  port: 3000,
  secrets: {
    cookie: testSecret(),
    fingerprint: testSecret(),
    subject: testSecret(),
    encryption: testSecret(),
  },
  admin: {
    username: 'ops',
    passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
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

test('rejects long but low-diversity secrets', () => {
  const input = validConfig();
  input.secrets.cookie = 'A'.repeat(48);

  assert.throws(() => loadConfig(input), /secrets\.cookie/);
});

test('requires independent cryptographic keys', () => {
  const input = validConfig();
  input.secrets.fingerprint = input.secrets.cookie;

  assert.throws(() => loadConfig(input), /independent/);
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