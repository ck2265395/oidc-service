import { readFile } from 'node:fs/promises';

import { loadConfig } from '../src/config.js';
import { createPlatformPool } from '../src/store.js';

const BATCH_SIZE = 5_000;

async function main(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  const config = loadConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
  const pool = createPlatformPool(config.databases.oidc);
  try {
    const queries = [
      ['expired OIDC documents', 'WITH batch AS (SELECT model, document_id FROM oidc_document WHERE expires_at IS NOT NULL AND expires_at < now() ORDER BY expires_at, model, document_id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM oidc_document d USING batch b WHERE d.model = b.model AND d.document_id = b.document_id'],
      ['audit records older than 90 days', "WITH batch AS (SELECT id FROM platform_audit WHERE created_at < now() - interval '90 days' ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM platform_audit a USING batch b WHERE a.id = b.id"],
      ['expired administrator sessions', "WITH batch AS (SELECT session_hash FROM admin_session WHERE created_at < now() - interval '8 hours' OR last_activity < now() - interval '30 minutes' ORDER BY last_activity, session_hash LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM admin_session a USING batch b WHERE a.session_hash = b.session_hash"],
      ['expired administrator login limits', "WITH batch AS (SELECT ip_hash FROM admin_login_limit WHERE window_started_at < now() - interval '24 hours' ORDER BY window_started_at, ip_hash LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM admin_login_limit a USING batch b WHERE a.ip_hash = b.ip_hash"],
    ] as const;

    for (const [label, sql] of queries) {
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
