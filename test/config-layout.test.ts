import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('repository documents an ignored local config and a tracked safe template', async () => {
  const [environmentExample, gitignore, configExample, deployment, packageJson, compose] = await Promise.all([
    readFile('.env.example', 'utf8'),
    readFile('.gitignore', 'utf8'),
    readFile('runtime/config.example.json', 'utf8'),
    readFile('docs/deploy.md', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('compose.yaml', 'utf8'),
  ]);

  assert.match(environmentExample, /OIDC_CONFIG_FILE=.\/runtime\/config\.local\.json/);
  assert.match(environmentExample, /OIDC_SIGNING_KEY_FILE=.\/runtime\/signing\.local\.json/);
  assert.match(gitignore, /!\/runtime\/config\.example\.json/);
  assert.doesNotMatch(configExample, /postgres:\/\/[^:\s"]+:(?!CHANGE_ME@)[^@\s"]+@/);
  assert.doesNotMatch(configExample, /"password"\s*:\s*"(?!CHANGE_ME)[^"]+"/);
  assert.match(deployment, /config\.local\.json/);
  assert.match(deployment, /OIDC_CONFIG_FILE/);
  assert.match(deployment, /test and production/i);
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts;
  assert.match(scripts['migrate:local'] ?? '', /--env-file=\.env\.local/);
  assert.match(compose, /\.\/runtime\/config\.local\.json:\/run\/identity\/config\.json:ro/);
  assert.match(compose, /\.\/runtime\/signing\.local\.json:\/run\/identity\/signing\.json:ro/);
  await assert.rejects(access('config.example.json'), { code: 'ENOENT' });
});
