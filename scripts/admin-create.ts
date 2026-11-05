import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import { hashScryptPassword } from '../src/common/security/security.js';
import { loadConfig } from '../src/infrastructure/config/config.schema.js';
import { createPlatformPool } from '../src/modules/application/infrastructure/application.store.js';
import { PostgresAdminRepository } from '../src/modules/admin/infrastructure/admin.repository.js';

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('A secure interactive terminal is required');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const configPath = process.env.OIDC_CONFIG_FILE;
  if (!configPath) throw new Error('OIDC_CONFIG_FILE must point to a protected JSON configuration file');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required');

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await prompt.question('Administrator username: ')).trim();
  prompt.close();
  if (!/^[A-Za-z0-9._@-]{3,128}$/.test(username)) throw new Error('Administrator username is invalid');

  const first = await readHidden('Administrator password: ');
  const second = await readHidden('Repeat administrator password: ');
  if (first !== second) throw new Error('Passwords do not match');

  const config = loadConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
  const pool = createPlatformPool(config.databases.oidc);
  try {
    await new PostgresAdminRepository(pool).createAdministrator(randomUUID(), username, hashScryptPassword(first));
  } finally {
    await pool.end();
  }
  process.stdout.write(`Administrator ${username} was created.\n`);
}

main().catch(() => {
  process.stderr.write('Administrator creation failed. Check the username, protected configuration, database, and password requirements.\n');
  process.exitCode = 1;
});
