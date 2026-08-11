import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSession, signSession } from '../src/auth';

test('a session cookie round trips and a tampered one is rejected', () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';

  const issuedAt = Date.now();
  const cookie = signSession(41, issuedAt);
  const session = readSession(cookie);

  assert.notEqual(session, null);
  assert.equal(session ? session.personId : null, 41);
  assert.equal(session ? session.issuedAt : null, issuedAt);

  assert.equal(readSession(`42.${issuedAt}.${cookie.split('.')[2]}`), null);
  assert.equal(readSession('41'), null);
  assert.equal(readSession(undefined), null);
});
