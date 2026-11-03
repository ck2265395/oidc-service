import 'reflect-metadata';

import { pathToFileURL } from 'node:url';

import { bootstrapNest } from './bootstrap/bootstrap.js';

export async function start(): Promise<void> {
  const { port } = await bootstrapNest({ infrastructure: true });
  process.stdout.write(`MOONDROP identity service listening on port ${port}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  start().catch(() => {
    process.stderr.write('Service startup failed. Check the protected configuration and server logs.\n');
    process.exitCode = 1;
  });
}
