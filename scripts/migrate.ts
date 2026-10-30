import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPlatformPool } from '../src/store.js';
import { loadConfig } from '../src/config.js';

const MIGRATION_LOCK_CLASS = 1_280_263_506;
const MIGRATION_LOCK_ID = 1;

async function migrate(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  const config = loadConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
  const pool = createPlatformPool(config.databases.oidc);
  const connection = await pool.connect();
  let lockAcquired = false;
  try {
    await connection.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_ID]);
    lockAcquired = true;
    await connection.query(
      'CREATE TABLE IF NOT EXISTS schema_migration (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );

    const directory = resolve(process.cwd(), 'sql/migrations');
    const names = (await readdir(directory))
      .filter((name) => /^\d{3,}_[a-z0-9_-]+\.sql$/.test(name))
      .sort();
    if (names.length === 0) throw new Error('No schema migrations are available');

    for (const name of names) {
      const source = await readFile(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const existing = await connection.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migration WHERE version = $1',
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error('An applied schema migration has changed');
        }
        continue;
      }

      await connection.query('BEGIN');
      try {
        await connection.query(source);
        await connection.query(
          'INSERT INTO schema_migration (version, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_LOCK_CLASS, MIGRATION_LOCK_ID]).catch(() => {});
    }
    connection.release();
    await pool.end();
  }
}

migrate().then(() => {
  process.stdout.write('Database migrations are up to date.\n');
}).catch(() => {
  process.stderr.write('Database migration failed. Check protected configuration and migration files.\n');
  process.exitCode = 1;
});
