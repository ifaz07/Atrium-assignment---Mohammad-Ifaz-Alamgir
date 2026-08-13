import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';

let centreDayWindow: (date: string) => { start: Date; end: Date };
let queueDailyDigests: (date: string) => Promise<boolean>;

before(async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.CENTRE_TIMEZONE = 'America/New_York';
  await resetTestDatabase();
  const digests = await import('../src/jobs/daily-digests');
  centreDayWindow = digests.centreDayWindow;
  queueDailyDigests = digests.queueDailyDigests;
});

test('centre-local day windows respect both daylight-saving transitions', () => {
  const spring = centreDayWindow('2026-03-08');
  const fall = centreDayWindow('2026-11-01');
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(fall.end.getTime() - fall.start.getTime(), 25 * 60 * 60 * 1000);
});

test('daily digests are idempotent and skip coaches with no schedule', async () => {
  const client = await connectToTestDatabase();
  try {
    await client.query("insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits) values (1, 3, 'Digest test', 'standard', 'scheduled', '2030-01-07T15:00:00Z', '2030-01-07T16:00:00Z', 40, 20)");
  } finally {
    await client.end();
  }

  assert.equal(await queueDailyDigests('2030-01-07'), true);
  assert.equal(await queueDailyDigests('2030-01-07'), false);

  const verify = await connectToTestDatabase();
  try {
    const rows = await verify.query<{ recipient: string; subject: string }>("select recipient, subject from email_outbox where event_key like '%digest:%'");
    assert.equal(rows.rows.filter((row) => row.recipient === 'oscar.lindqvist@atrium.local').length, 1);
    assert.equal(rows.rows.filter((row) => row.recipient === 'halle.ostrowski@atrium.local').length, 0);
    assert.equal(rows.rows.filter((row) => row.recipient === 'admin@atrium.local').length, 1);
  } finally {
    await verify.end();
  }
});
