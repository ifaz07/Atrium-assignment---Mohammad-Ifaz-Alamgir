import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';
import { formatCentreDateTime } from '../src/email/format';

let server: Server;
let baseUrl = '';
let coachCookie = '';
let participantCookie = '';
let secondCoachCookie = '';
let createSessionToken: () => string;
let hashSessionToken: (token: string) => string;
let sessionCookie = '';

test('email dates are readable and shown in centre-local time', () => {
  assert.equal(
    formatCentreDateTime('2026-08-19T00:15:00.000Z'),
    'Tuesday, August 18, 2026 at 8:15 PM EDT (America/New_York)'
  );
});

async function cookie(personId: number): Promise<string> {
  const token = createSessionToken();
  const client = await connectToTestDatabase();
  await client.query("insert into app_session (person_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')", [personId, hashSessionToken(token)]);
  await client.end();
  return `${sessionCookie}=${token}`;
}

async function messages(): Promise<Array<{ recipient: string; subject: string; status: string }>> {
  const client = await connectToTestDatabase();
  const result = await client.query<{ recipient: string; subject: string; status: string }>('select recipient, subject, status from email_outbox order by id');
  await client.end();
  return result.rows;
}

before(async () => {
  process.env.SESSION_SECRET = 'atrium-test-secret';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.SCHEDULER_ENABLED = 'false';
  const auth = await import('../src/auth');
  const app = await import('../src/app');
  createSessionToken = auth.createSessionToken;
  hashSessionToken = auth.hashSessionToken;
  sessionCookie = auth.SESSION_COOKIE;
  await resetTestDatabase();
  coachCookie = await cookie(3);
  participantCookie = await cookie(2);
  secondCoachCookie = await cookie(6);
  server = app.createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('booking and cancellation events queue the required recipients', async () => {
  const start = new Date('2030-01-07T15:00:00.000Z');
  const create = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { Cookie: coachCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: 1,
      discipline: 'Email test',
      session_type: 'standard',
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString()
    })
  });
  assert.equal(create.status, 201);
  const session = await create.json() as { id: number };
  assert.equal((await messages()).some((message) => message.recipient === 'admin@atrium.local' && message.subject.includes('Room booked')), true);

  const enrol = await fetch(`${baseUrl}/api/sessions/${session.id}/enrolments`, { method: 'POST', headers: { Cookie: participantCookie } });
  assert.equal(enrol.status, 201);
  assert.equal((await messages()).some((message) => message.recipient === 'oscar.lindqvist@atrium.local' && message.subject.includes('New booking')), true);

  const participantCancel = await fetch(`${baseUrl}/api/sessions/${session.id}/enrolments/cancel`, { method: 'POST', headers: { Cookie: participantCookie } });
  assert.equal(participantCancel.status, 200);
  assert.equal((await messages()).some((message) => message.recipient === 'oscar.lindqvist@atrium.local' && message.subject.includes('Booking cancelled')), true);

  await fetch(`${baseUrl}/api/sessions/${session.id}/enrolments`, { method: 'POST', headers: { Cookie: participantCookie } });
  const sessionCancel = await fetch(`${baseUrl}/api/sessions/${session.id}/cancel`, { method: 'POST', headers: { Cookie: coachCookie } });
  assert.equal(sessionCancel.status, 200);
  const queued = await messages();
  assert.equal(queued.some((message) => message.recipient === 'sofia.marino@atrium.local' && message.subject.includes('Session cancelled')), true);
  assert.equal(queued.some((message) => message.recipient === 'admin@atrium.local' && message.subject.includes('Room booking cancelled')), true);
});

test('a failed booking queues no email', async () => {
  const before = (await messages()).length;
  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { Cookie: participantCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 403);
  assert.equal((await messages()).length, before);
});

test('a coach attending another coach session is notified when it changes', async () => {
  const client = await connectToTestDatabase();
  const inserted = await client.query<{ id: number }>(
    "insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits) values (2, 6, 'Coach update', 'standard', 'scheduled', '2030-01-08T15:00:00Z', '2030-01-08T16:00:00Z', 40, 20) returning id"
  );
  await client.end();
  const sessionId = inserted.rows[0].id;
  assert.equal((await fetch(`${baseUrl}/api/sessions/${sessionId}/enrolments`, { method: 'POST', headers: { Cookie: coachCookie } })).status, 201);
  const update = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { Cookie: secondCoachCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ discipline: 'Updated coach session' })
  });
  assert.equal(update.status, 200);
  assert.equal((await messages()).some((message) => message.recipient === 'oscar.lindqvist@atrium.local' && message.subject.includes('Session updated')), true);
});

test('the delivery worker can use a deterministic transport', async () => {
  const delivered: Array<{ to: string; subject: string }> = [];
  const { deliverPendingEmails } = await import('../src/email/worker');
  const count = await deliverPendingEmails(100, async (message) => {
    delivered.push({ to: message.to, subject: message.subject });
  });
  assert.equal(count > 0, true);
  assert.equal(delivered.length, count);
  assert.equal((await messages()).every((message) => message.status === 'sent'), true);
});
