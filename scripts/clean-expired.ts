import { readFile } from 'node:fs/promises';

import { loadConfig } from '../src/config.js';
import { createPlatformPool } from '../src/store.js';
import { expiredDataQueries } from '../src/cleanup.js';

const BATCH_SIZE = 5_000;

async function main(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  const config = loadConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
  const pool = createPlatformPool(config.databases.oidc);
  try {
    for (const [label, sql] of expiredDataQueries) {
      let total = 0;
      while (true) {
        const result = await pool.query(sql, [BATCH_SIZE]);
        const deleted = result.rowCount ?? 0;
        total += deleted;
        if (deleted < BATCH_SIZE) break;
      }
      process.stdout.write(label + ': ' + total + ' removed\n');
    }
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('Expired data cleanup failed. Check protected configuration and database availability.\n');
  process.exitCode = 1;
});
