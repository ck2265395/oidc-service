import { randomBytes, scryptSync } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('A secure interactive terminal is required');
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolveValue, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') {
          value += character;
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const outputArgumentIndex = process.argv.indexOf('--out');
  const outputArgument = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
  if (!outputArgument) {
    throw new Error('Usage: npm run admin:password -- --out <protected-file>');
  }

  const first = await readHidden('New administrator password: ');
  const second = await readHidden('Repeat administrator password: ');
  if (first.length < 12 || first.length > 1024 || first !== second) {
    throw new Error('Passwords must match and contain between 12 and 1024 characters');
  }

  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(first, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('base64url');
  const encodedHash = `scrypt$32768$8$1$${salt}$${derived}\n`;

  const outputPath = resolve(outputArgument);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const file = await open(outputPath, 'wx', 0o600);
  try {
    await file.writeFile(encodedHash, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }

  process.stdout.write(`Password hash saved to ${outputPath}; neither password nor hash was printed.\n`);
}

main().catch(() => {
  process.stderr.write('Administrator password setup failed. Check the terminal and protected output path.\n');
  process.exitCode = 1;
});