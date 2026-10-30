import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';

import { AccountService, PostgresAccountSource, claimsForScopes, type AccountRecord, type AccountSource } from '../src/accounts.js';
import type { Pool } from 'pg';

const legacyHmacKey = 'independent-test-only-legacy-key';
const fingerprintKey = randomBytes(32).toString('base64url');
const subjectKey = randomBytes(32).toString('base64url');
const passwordDigest = (password: string) =>
  createHmac('sha256', legacyHmacKey).update(password, 'utf8').digest('hex');

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    uuid: 'internal-user-1',
    username: 'tester',
    password: passwordDigest('correct horse battery'),
    status: 1,
    nickname: 'Test Person',
    email: 'test@example.invalid',
    profilepic: null,
    ...overrides,
  };
}

function source(records: AccountRecord[]): AccountSource {
  return {
    findByUuid: async (uuid) => records.find((record) => record.uuid === uuid) ?? null,
    lookup: async (type, value) => records.filter((record) => record[type] === value),
  };
}

function service(records: AccountRecord[]) {
  return new AccountService(source(records), {
    legacyHmacKey,
    fingerprintKey,
    subjectKey,
  });
}

test('authenticates exact usernames and returns opaque identity data', async () => {
  const result = await service([account()]).authenticate({ type: 'username', value: 'tester' }, 'correct horse battery');

  assert.ok(result);
  assert.equal(typeof result.sub, 'string');
  assert.equal(result.sub.includes('internal-user-1'), false);
  assert.equal('password' in result, false);
  assert.equal('email' in result, false);
});

test('does not identify users by an ambiguous email', async () => {
  const accounts = [
    account({ uuid: 'one', email: 'shared@example.invalid' }),
    account({ uuid: 'two', username: 'other', email: 'shared@example.invalid' }),
  ];

  assert.equal(
    await service(accounts).authenticate({ type: 'email', value: 'shared@example.invalid' }, 'correct horse battery'),
    null,
  );
});

test('bad credentials and disabled accounts fail closed', async () => {
  assert.equal(await service([account()]).authenticate({ type: 'username', value: 'tester' }, 'wrong'), null);
  assert.equal(
    await service([account({ status: 0 })]).authenticate({ type: 'username', value: 'tester' }, 'correct horse battery'),
    null,
  );
});

test('rejects malformed identifiers and passwords without querying the source', async () => {
  let lookups = 0;
  const tracked: AccountSource = {
    findByUuid: async () => null,
    lookup: async () => { lookups += 1; return []; },
  };
  const auth = new AccountService(tracked, { legacyHmacKey, fingerprintKey, subjectKey });

  assert.equal(await auth.authenticate({ type: 'username', value: ['tester'] }, 'password'), null);
  assert.equal(await auth.authenticate({ type: 'username', value: 'tester' }, { secret: 'password' }), null);
  assert.equal(lookups, 0);
});

test('password changes invalidate old credentials without changing the subject', async () => {
  const oldRecord = account();
  const auth = service([oldRecord]);
  const initial = await auth.authenticate({ type: 'username', value: 'tester' }, 'correct horse battery');
  assert.ok(initial);

  const changed = account({ password: passwordDigest('new password value') });
  const updatedAuth = service([changed]);
  const afterPasswordChange = await updatedAuth.authenticate(
    { type: 'username', value: 'tester' },
    'new password value',
  );
  assert.ok(afterPasswordChange);

  assert.equal(afterPasswordChange.sub, initial.sub);
  assert.notEqual(afterPasswordChange.fingerprint, initial.fingerprint);
  assert.equal(await updatedAuth.resolve(initial.uuid, initial.fingerprint, 'client-sector'), null);
});

test('subjects are stable within a sector and isolated across sectors', async () => {
  const auth = service([account()]);
  const first = await auth.authenticate({ type: 'username', value: 'tester' }, 'correct horse battery');
  assert.ok(first);

  const same = await auth.authenticate({ type: 'username', value: 'tester' }, 'correct horse battery');
  const otherSector = await service([account()]).authenticate(
    { type: 'username', value: 'tester' },
    'correct horse battery',
    'other-sector',
  );

  assert.ok(same);
  assert.ok(otherSector);
  assert.equal(first.sub, same.sub);
  assert.notEqual(first.sub, otherSector.sub);
});
test('OIDC profile claims are limited to the requested scopes', async () => {
  const identity = await service([account()]).authenticate(
    { type: 'username', value: 'tester' },
    'correct horse battery',
  );
  assert.ok(identity);

  const profile = claimsForScopes(identity, new Set(['profile']));
  assert.deepEqual(profile, { name: 'Test Person' });
  assert.equal('email' in profile, false);
  assert.equal('email_verified' in profile, false);

  const email = claimsForScopes(identity, new Set(['email']));
  assert.deepEqual(email, { email: 'test@example.invalid' });
  assert.equal('name' in email, false);
});

test('PostgreSQL account lookup uses a fixed SELECT and parameterized values', async () => {
  let capturedQuery = '';
  let capturedValues: unknown[] | undefined;
  const fakePool = {
    query: async (query: string, values?: unknown[]) => {
      capturedQuery = query;
      capturedValues = values;
      return { rows: [] };
    },
    end: async () => undefined,
  } as unknown as Pool;
  const accounts = new PostgresAccountSource(fakePool);
  const attackerInput = "name' OR 1=1 --";

  await accounts.lookup('email', attackerInput);

  assert.match(capturedQuery, /^SELECT /);
  assert.match(capturedQuery, /FROM "USER" WHERE "email" = \$1 LIMIT 2$/);
  assert.deepEqual(capturedValues, [attackerInput]);
  await accounts.close();
});
