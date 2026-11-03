import 'reflect-metadata';

import { pathToFileURL } from 'node:url';

import { bootstrapNest } from './bootstrap/bootstrap.js';

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  bootstrapNest({ infrastructure: true }).then(({ port }) => {
    process.stdout.write(`Nest identity service listening on port ${port}\n`);
  }).catch(() => {
    process.stderr.write('Nest service startup failed. Check the protected configuration and server logs.\n');
    process.exitCode = 1;
  });
}
