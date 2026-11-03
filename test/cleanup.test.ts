import assert from 'node:assert/strict';
import test from 'node:test';

import { expiredDataQueries } from '../src/cleanup.js';

test('expired data cleanup removes stale and revoked developer sessions in bounded batches', () => {
  const query = expiredDataQueries.find(([label]) => label === 'expired developer sessions');

  assert.ok(query);
  assert.match(query[1], /absolute_expires_at < now\(\) - interval '7 days'/);
  assert.match(query[1], /last_activity < now\(\) - interval '14 days'/);
  assert.match(query[1], /revoked_at < now\(\) - interval '7 days'/);
  assert.match(query[1], /LIMIT \$1 FOR UPDATE SKIP LOCKED/);
});
