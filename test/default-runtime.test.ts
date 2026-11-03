import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path: string): Promise<string> { return readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }

test('default runtime targets Nest and preserves protected configuration paths', async () => {
  const packageJson = JSON.parse(await text('package.json')) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.dev ?? '', /src\/main\.ts/);
  assert.doesNotMatch(packageJson.scripts.dev ?? '', /src\/legacy-main\.ts/);
  assert.equal(packageJson.scripts.start, 'node dist/src/main.js');
  assert.equal(packageJson.scripts['start:legacy'], 'node dist/src/legacy-main.js');

  const main = await text('src/main.ts');
  assert.match(main, /bootstrapNest/);
  assert.doesNotMatch(main, /createApplication/);
  const compose = await text('compose.yaml');
  assert.match(compose, /OIDC_CONFIG_FILE: \/run\/identity\/config\.json/);
  assert.match(compose, /OIDC_SIGNING_KEY_FILE: \/run\/identity\/signing\.json/);
});

test('default runtime production image includes the Nest build and React assets', async () => {
  const dockerfile = await text('Dockerfile');
  assert.match(dockerfile, /COPY --from=build[^\n]+\/app\/dist \.\/dist/);
  assert.match(dockerfile, /COPY --from=build[^\n]+\/app\/public \.\/public/);
  assert.match(dockerfile, /CMD \["node", "dist\/src\/main\.js"\]/);
});
