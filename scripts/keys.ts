import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

async function main(): Promise<void> {
  const outputArgumentIndex = process.argv.indexOf('--out');
  const outputArgument = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
  if (!outputArgument) {
    throw new Error('Usage: npm run keys -- --out <protected-file>');
  }

  const outputPath = resolve(outputArgument);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });

  const pair = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicExponent: 0x10001,
  });
  const privateKey = pair.privateKey.export({ format: 'jwk' });
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(`${publicKey.n}.${publicKey.e}`)
    .digest('base64url');

  const keyMaterial = {
    secrets: {
      cookie: randomSecret(),
      fingerprint: randomSecret(),
      subject: randomSecret(),
      encryption: randomSecret(),
    },
    signingKey: {
      kid,
      algorithm: 'RS256',
      privateJwk: privateKey,
      publicJwk: publicKey,
    },
  };

  const file = await open(outputPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(keyMaterial, null, 2)}\n`, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }

  process.stdout.write(`Key material saved to ${outputPath}; secret values were not printed.\n`);
}

main().catch(() => {
  process.stderr.write('Key generation failed. Check the protected output path and file permissions.\n');
  process.exitCode = 1;
});