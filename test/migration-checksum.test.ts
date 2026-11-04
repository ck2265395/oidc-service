import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { migrationChecksums } from '../scripts/migration-checksum.js';

test('migration checksums accept equivalent LF and CRLF files', () => {
  const lf = 'CREATE TABLE example (id integer);\nSELECT 1;\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = migrationChecksums(lf);
  const crlfResult = migrationChecksums(crlf);

  assert.equal(lfResult.canonical, crlfResult.canonical);
  assert.equal(lfResult.accepted.has(createHash('sha256').update(crlf).digest('hex')), true);
  assert.equal(crlfResult.accepted.has(createHash('sha256').update(lf).digest('hex')), true);
});

test('migration checksums still reject real SQL changes', () => {
  const original = migrationChecksums('SELECT 1;\n');
  const changed = migrationChecksums('SELECT 2;\n');
  assert.equal(original.accepted.has(changed.canonical), false);
});
