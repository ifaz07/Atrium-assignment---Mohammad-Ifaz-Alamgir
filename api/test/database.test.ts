import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';

test('the isolated test database accepts the starter migration', async () => {
  await resetTestDatabase();
  const client = await connectToTestDatabase();

  try {
    const result = await client.query<{ count: number }>('select count(*)::int as count from room');
    assert.equal(result.rows[0].count, 12);
  } finally {
    await client.end();
  }
});
