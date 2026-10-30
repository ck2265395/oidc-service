import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

import { createApplication } from './app.js';
import { loadConfig } from './config.js';

export async function start(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) {
    throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  }

  const rawConfig = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  const config = loadConfig(rawConfig);
  const server = createServer(createApplication(config));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const shutdown = (): void => {
    server.close((error) => {
      if (error) {
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  start().catch(() => {
    // Do not print configuration values or nested driver errors.
    process.stderr.write('Service startup failed. Check the protected configuration and server logs.\n');
    process.exitCode = 1;
  });
}