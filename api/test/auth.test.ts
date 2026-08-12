import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../src/auth';

test('passwords use bcrypt and session tokens are keyed before storage', async () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';

  const passwordHash = await hashPassword('correct horse battery staple');
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);

  assert.match(passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword('correct horse battery staple', passwordHash), true);
  assert.equal(await verifyPassword('wrong password', passwordHash), false);
  assert.notEqual(token, tokenHash);
  assert.equal(tokenHash, hashSessionToken(token));
});
