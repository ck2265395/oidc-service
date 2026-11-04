import { randomBytes } from 'node:crypto';

import { loadConfig, type ServiceConfig } from '../../src/infrastructure/config/config.schema.js';

const secret = (): string => randomBytes(32).toString('base64url');

export function testServiceConfig(): ServiceConfig {
  return loadConfig({
    mode: 'test',
    issuer: 'https://identity.example.test',
    port: 3000,
    secrets: {
      legacyHmacKey: secret(),
      cookie: secret(),
      fingerprint: secret(),
      subject: secret(),
      encryption: secret(),
    },
    admin: { username: 'ops', passwordHash: 'scrypt$16384$8$1$salt$hash' },
    databases: {
      oidc: 'postgres://oidc:secret@localhost:5432/oidc_test',
      accounts: 'postgres://reader:secret@localhost:5432/accounts_test',
    },
    redisUrl: 'redis://localhost:6379/0',
  });
}
