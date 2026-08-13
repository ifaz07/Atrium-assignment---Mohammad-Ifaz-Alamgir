import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';

let server: Server;
let baseUrl = '';
let coachCookie = '';
let secondCoachCookie = '';
let createApp: () => import('express').Express;
let createSessionToken: () => string;
let hashSessionToken: (token: string) => string;
let sessionCookie = '';

function futureBusinessTime(daysAhead: number, hourUtc = 16): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(hourUtc, 0, 0, 0);

  while (new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(date) === 'Sun') {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

async function createCookie(personId: number): Promise<string> {
  const token = createSessionToken();
  const client = await connectToTestDatabase();
  try {
    await client.query(
      "insert into app_session (person_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
      [personId, hashSessionToken(token)]
    );
  } finally {
    await client.end();
  }
  return `${sessionCookie}=${token}`;
}

async function book(cookie: string, roomId: number, start: Date, sessionType = 'standard') {
  const durationMinutes = sessionType === 'short' ? 45 : sessionType === 'intensive' ? 210 : 60;
  return fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: roomId,
      discipline: 'test discipline',
      session_type: sessionType,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + durationMinutes * 60 * 1000).toISOString()
    })
  });
}

before(async () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const auth = await import('../src/auth');
  const app = await import('../src/app');
  createApp = app.createApp;
  createSessionToken = auth.createSessionToken;
  hashSessionToken = auth.hashSessionToken;
  sessionCookie = auth.SESSION_COOKIE;
  await resetTestDatabase();
  coachCookie = await createCookie(3);

  const client = await connectToTestDatabase();
  try {
    const coach = await client.query<{ id: number }>("select id from person where kind = 'coach' and id <> 3 order by id limit 1");
    secondCoachCookie = await createCookie(coach.rows[0].id);
  } finally {
    await client.end();
  }

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('a coach booking charges the correct fee and permits back-to-back sessions', async () => {
  const start = futureBusinessTime(4);
  const client = await connectToTestDatabase();
  const beforeCredits = await client.query<{ credits: number }>('select credits from person where id = 3');
  await client.end();

  const first = await book(coachCookie, 1, start);
  const second = await book(coachCookie, 1, new Date(start.getTime() + 60 * 60 * 1000));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const verify = await connectToTestDatabase();
  try {
    const afterCredits = await verify.query<{ credits: number }>('select credits from person where id = 3');
    assert.equal(afterCredits.rows[0].credits, beforeCredits.rows[0].credits - 80);
  } finally {
    await verify.end();
  }
});

test('a coach booking rejects early, Sunday, out-of-hours, room conflict, and personal conflict requests', async () => {
  const tooSoon = futureBusinessTime(1);
  const early = await book(coachCookie, 2, tooSoon);
  assert.equal(early.status, 400);

  const unsupportedMinute = futureBusinessTime(4);
  unsupportedMinute.setUTCMinutes(48, 0, 0);
  const unsupportedMinuteResponse = await book(coachCookie, 2, unsupportedMinute);
  assert.equal(unsupportedMinuteResponse.status, 400);

  const sunday = futureBusinessTime(4);
  while (new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(sunday) !== 'Sun') {
    sunday.setUTCDate(sunday.getUTCDate() + 1);
  }
  const sundayResponse = await book(coachCookie, 2, sunday);
  assert.equal(sundayResponse.status, 400);

  const outOfHours = futureBusinessTime(5, 8);
  const outOfHoursResponse = await book(coachCookie, 2, outOfHours);
  assert.equal(outOfHoursResponse.status, 400);

  const start = futureBusinessTime(6);
  const initialBooking = await book(coachCookie, 1, start);
  assert.equal(initialBooking.status, 201);
  const roomConflict = await book(secondCoachCookie, 1, start);
  assert.equal(roomConflict.status, 409);

  const personalConflict = await book(coachCookie, 2, new Date(start.getTime() + 30 * 60 * 1000));
  assert.equal(personalConflict.status, 409);
});

test('simultaneous requests cannot double-book a room', async () => {
  const start = futureBusinessTime(7);
  const [first, second] = await Promise.all([book(coachCookie, 3, start), book(secondCoachCookie, 3, start)]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('a coach cancellation returns the correct 100 percent room-fee refund', async () => {
  const start = futureBusinessTime(8);
  const client = await connectToTestDatabase();
  const beforeCredits = await client.query<{ credits: number }>('select credits from person where id = 3');
  const participant = await client.query<{ id: number; credits: number }>("select id, credits from person where kind = 'participant' order by id limit 1");
  await client.end();

  const booking = await book(coachCookie, 4, start, 'short');
  assert.equal(booking.status, 201);
  const created = await booking.json();

  const enrol = await connectToTestDatabase();
  try {
    await enrol.query('update person set credits = credits - 15 where id = $1', [participant.rows[0].id]);
    await enrol.query(
      "insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at) values ($1, $2, 'active', 15, 0, now())",
      [created.id, participant.rows[0].id]
    );
  } finally {
    await enrol.end();
  }

  const cancellation = await fetch(`${baseUrl}/api/sessions/${created.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: coachCookie }
  });
  const cancelled = await cancellation.json();
  assert.equal(cancellation.status, 200);
  assert.equal(cancelled.room_fee_refunded, 30);
  assert.equal(cancelled.enrolments_cancelled, 1);
  assert.equal(cancelled.seat_fees_refunded, 15);

  const verify = await connectToTestDatabase();
  try {
    const afterCredits = await verify.query<{ credits: number }>('select credits from person where id = 3');
    const participantAfter = await verify.query<{ credits: number }>('select credits from person where id = $1', [participant.rows[0].id]);
    const enrolment = await verify.query<{ status: string; credits_refunded: number }>('select status, credits_refunded from enrolment where session_id = $1 and person_id = $2', [created.id, participant.rows[0].id]);
    assert.equal(afterCredits.rows[0].credits, beforeCredits.rows[0].credits);
    assert.equal(participantAfter.rows[0].credits, participant.rows[0].credits);
    assert.equal(enrolment.rows[0].status, 'cancelled');
    assert.equal(enrolment.rows[0].credits_refunded, 15);
  } finally {
    await verify.end();
  }

  const repeatedCancellation = await fetch(`${baseUrl}/api/sessions/${created.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: coachCookie }
  });
  assert.equal(repeatedCancellation.status, 409);

  const afterRepeat = await connectToTestDatabase();
  try {
    const coachCredits = await afterRepeat.query<{ credits: number }>('select credits from person where id = 3');
    const participantCredits = await afterRepeat.query<{ credits: number }>('select credits from person where id = $1', [participant.rows[0].id]);
    assert.equal(coachCredits.rows[0].credits, beforeCredits.rows[0].credits);
    assert.equal(participantCredits.rows[0].credits, participant.rows[0].credits);
  } finally {
    await afterRepeat.end();
  }
});
