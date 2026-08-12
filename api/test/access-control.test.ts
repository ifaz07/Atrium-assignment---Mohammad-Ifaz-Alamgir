import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';

let server: Server;
let baseUrl = '';
let participantCookie = '';
let coachCookie = '';
let adminCookie = '';
let coachSessionId = 0;
let createApp: () => import('express').Express;
let createSessionToken: () => string;
let hashSessionToken: (token: string) => string;
let sessionCookie = '';

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

  const client = await connectToTestDatabase();
  try {
    const session = await client.query<{ id: number }>(
      "select id from session where coach_id = 3 and status = 'scheduled' order by id limit 1"
    );
    coachSessionId = session.rows[0].id;
  } finally {
    await client.end();
  }

  participantCookie = await createCookie(2);
  coachCookie = await createCookie(3);
  adminCookie = await createCookie(1);

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('a participant cannot read administrator data or change a coach session', async () => {
  const people = await fetch(`${baseUrl}/api/people`, { headers: { Cookie: participantCookie } });
  const rooms = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: participantCookie } });
  const update = await fetch(`${baseUrl}/api/sessions/${coachSessionId}`, {
    method: 'PATCH',
    headers: { Cookie: participantCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ discipline: 'career' })
  });
  const cancel = await fetch(`${baseUrl}/api/sessions/${coachSessionId}/cancel`, {
    method: 'POST',
    headers: { Cookie: participantCookie }
  });
  const create = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { Cookie: participantCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(people.status, 403);
  assert.equal(rooms.status, 403);
  assert.equal(update.status, 403);
  assert.equal(cancel.status, 403);
  assert.equal(create.status, 403);
});

test('a participant never receives attendee data and a coach sees attendees only for their own session', async () => {
  const participantResponse = await fetch(`${baseUrl}/api/sessions/${coachSessionId}`, {
    headers: { Cookie: participantCookie }
  });
  const participantSession = await participantResponse.json();
  const coachResponse = await fetch(`${baseUrl}/api/sessions/${coachSessionId}`, {
    headers: { Cookie: coachCookie }
  });
  const coachSession = await coachResponse.json();

  assert.equal(participantResponse.status, 200);
  assert.equal('attendees' in participantSession, false);
  assert.equal(coachResponse.status, 200);
  assert.equal(Array.isArray(coachSession.attendees), true);
});

test('an administrator can access administrator-only lists', async () => {
  const people = await fetch(`${baseUrl}/api/people`, { headers: { Cookie: adminCookie } });
  const rooms = await fetch(`${baseUrl}/api/rooms`, { headers: { Cookie: adminCookie } });

  assert.equal(people.status, 200);
  assert.equal(Array.isArray(await people.json()), true);
  assert.equal(rooms.status, 200);
  assert.equal(Array.isArray(await rooms.json()), true);
});
