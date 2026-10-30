import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

import type { JWKS } from 'oidc-provider';
import { createClient } from 'redis';

import { AccountService, createAccountPool, PostgresAccountSource } from './accounts.js';
import { createApplication } from './app.js';
import { createOidcAdapterFactory } from './adapter.js';
import { loadConfig } from './config.js';
import { createProvider } from './provider.js';
import { createInteractionRouter } from './interactions.js';
import { createDeveloperRouter } from './developer.js';
import { createAdminRouter } from './admin.js';
import { createUserPortalRouter } from './user-portal.js';
import { ApplicationService } from './platform.js';
import { ApplicationGroupService } from './groups.js';
import { createPlatformPool, PostgresApplicationRepository } from './store.js';
import { RedisLoginRateLimiter } from './login-limiter.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid protected key file');
  }
  return value as Record<string, unknown>;
}

async function readSigningKeys(): Promise<JWKS> {
  const keyPath = process.env.OIDC_SIGNING_KEY_FILE;
  if (!keyPath) throw new Error('OIDC_SIGNING_KEY_FILE must point to protected key material');

  const root = record(JSON.parse(await readFile(keyPath, 'utf8')) as unknown);
  const signing = record(root.signingKey);
  const privateJwk = record(signing.privateJwk);
  const kid = signing.kid;
  if (
    privateJwk.kty !== 'RSA' ||
    typeof privateJwk.n !== 'string' ||
    typeof privateJwk.d !== 'string' ||
    typeof kid !== 'string' ||
    kid.length < 16
  ) {
    throw new Error('Invalid protected signing key');
  }

  return {
    keys: [{ ...privateJwk, kid, alg: 'RS256', use: 'sig' }],
  } as JWKS;
}

export async function start(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) {
    throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  }

  const rawConfig = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  const config = loadConfig(rawConfig);
  const oidcPool = createPlatformPool(config.databases.oidc);
  const accountPool = createAccountPool(config.databases.accounts);
  const redisClient = createClient({ url: config.redisUrl });
  redisClient.on('error', () => {});
  const accountSource = new PostgresAccountSource(accountPool);
  const applicationRepository = new PostgresApplicationRepository(oidcPool, config.mode === 'production' ? 'production' : 'development');
  const applications = new ApplicationService(
    applicationRepository,
    config.mode === 'production' ? 'production' : 'development',
    undefined,
    undefined,
    config.secrets.encryption,
  );
  const groups = new ApplicationGroupService(applicationRepository);
  const accounts = new AccountService(accountSource, {
    legacyHmacKey: config.secrets.legacyHmacKey,
    fingerprintKey: config.secrets.fingerprint,
    subjectKey: config.secrets.subject,
  });
  const signingKeys = await readSigningKeys();

  try {
    await Promise.all([oidcPool.query('SELECT 1'), accountPool.query('SELECT 1'), redisClient.connect()]);
    const loginRateLimiter = new RedisLoginRateLimiter(
      redisClient,
      config.secrets.fingerprint,
      config.loginRateLimit.windowSeconds,
      config.loginRateLimit.accountAttempts,
      config.loginRateLimit.ipAttempts,
    );
    const provider = createProvider(
      config.issuer,
      createOidcAdapterFactory(oidcPool, applications, redisClient),
      accounts,
      applications,
      config.secrets.cookie,
      signingKeys,
    );
    const providerClient = provider.Client as typeof provider.Client & { cacheClear: (clientId?: string) => void };
    applications.setClientCacheClearer((clientId) => providerClient.cacheClear(clientId));
    const interactions = createInteractionRouter(
      provider,
      accounts,
      applications,
      config.secrets.cookie,
      config.issuer.startsWith('https:'),
      loginRateLimiter,
    );
    const developer = createDeveloperRouter(
      provider,
      accounts,
      applications,
      groups,
      config.issuer,
      config.issuer.startsWith('https:'),
    );
    const admin = createAdminRouter(oidcPool, config, applications, groups);
    const userPortal = createUserPortalRouter(oidcPool, provider, accounts, config);
    const readiness = async (): Promise<void> => {
      await Promise.all([
        oidcPool.query('SELECT 1'),
        accountPool.query('SELECT 1'),
        redisClient.ping(),
      ]);
    };
    const server = createServer(createApplication(config, provider, interactions, developer, admin, userPortal, readiness));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const shutdown = (): void => {
      server.close((error) => {
        void Promise.all([oidcPool.end(), accountPool.end(), redisClient.isOpen ? redisClient.quit() : Promise.resolve()]).then(() => {
          if (error) process.exitCode = 1;
        });
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    await Promise.allSettled([oidcPool.end(), accountPool.end(), redisClient.isOpen ? redisClient.quit() : Promise.resolve()]);
    throw error;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  start().catch(() => {
    process.stderr.write('Service startup failed. Check the protected configuration and server logs.\n');
    process.exitCode = 1;
  });
}
