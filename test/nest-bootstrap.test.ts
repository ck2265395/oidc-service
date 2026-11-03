import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bootstrapNest } from '../src/bootstrap/bootstrap.js';
import { ConfigService } from '../src/infrastructure/config/config.service.js';

const secret = (): string => randomBytes(32).toString('base64url');
const input = () => ({
  mode: 'test', issuer: 'http://127.0.0.1:3000', port: 3000,
  secrets: { legacyHmacKey: secret(), cookie: secret(), fingerprint: secret(), subject: secret(), encryption: secret() },
  admin: { username: 'ops', passwordHash: 'scrypt$16384$8$1$salt$hash' },
  databases: { oidc: 'postgres://oidc:secret@localhost:5432/oidc_test', accounts: 'postgres://reader:secret@localhost:5432/accounts_test' },
  redisUrl: 'redis://localhost:6379/0',
});

test('Nest runtime loads protected configuration and supports isolated bootstrap', async (context) => {
  const path = join(tmpdir(), `oidc-nest-config-${randomBytes(8).toString('hex')}.json`);
  await writeFile(path, JSON.stringify(input()), { encoding: 'utf8', mode: 0o600 });
  context.after(async () => { await import('node:fs/promises').then(({ unlink }) => unlink(path).catch(() => undefined)); });

  const config = await ConfigService.fromFile(path);
  assert.equal(config.get().mode, 'test');
  assert.equal(config.get(), config.get());
  assert.ok(Object.isFrozen(config.get()));
  await assert.rejects(ConfigService.fromFile(undefined), /OIDC_CONFIG_FILE/);
  await assert.rejects(ConfigService.fromFile(path + '.missing'));

  const handle = await bootstrapNest({ configPath: path, port: 0, logger: false });
  context.after(handle.close);
  assert.ok(handle.port > 0);

  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.dev ?? '', /src\/main\.ts/);
  assert.equal(pkg.scripts.start, 'node dist/src/main.js');
  assert.equal(pkg.scripts['dev:nest'], undefined);
});
