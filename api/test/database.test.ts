import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectToTestDatabase, resetTestDatabase } from './helpers/test-database';

test('the isolated test database accepts the starter migration', async () => {
  await resetTestDatabase();
  const client = await connectToTestDatabase();

  try {
    const rooms = await client.query<{ count: number }>('select count(*)::int as count from room');
    const fractionalCredits = await client.query<{ count: number }>(
      'select count(*)::int as count from person where credits <> trunc(credits)'
    );
    const invalidSessions = await client.query<{ count: number }>(
      "select count(*)::int as count from session where session_type = 'intensive' and ends_at - starts_at <> interval '210 minutes'"
    );
    const roomOverlaps = await client.query<{ count: number }>(
      "select count(*)::int as count from session first_session join session second_session on first_session.room_id = second_session.room_id and first_session.id < second_session.id and first_session.status <> 'cancelled' and second_session.status <> 'cancelled' and tstzrange(first_session.starts_at, first_session.ends_at, '[)') && tstzrange(second_session.starts_at, second_session.ends_at, '[)')"
    );
    const closedTimeSessions = await client.query<{ count: number }>(
      "with local_sessions as (select starts_at at time zone 'America/New_York' as local_start, ends_at at time zone 'America/New_York' as local_end from session where status = 'scheduled') select count(*)::int as count from local_sessions where extract(isodow from local_start) = 7 or local_start::time < time '07:00' or local_end::date <> local_start::date or local_end::time > time '21:00'"
    );
    const ownEnrolments = await client.query<{ count: number }>(
      "select count(*)::int as count from enrolment join session on session.id = enrolment.session_id where enrolment.status = 'active' and enrolment.person_id = session.coach_id"
    );
    const overCapacitySessions = await client.query<{ count: number }>(
      "select count(*)::int as count from (select session.id from session join room on room.id = session.room_id left join enrolment on enrolment.session_id = session.id and enrolment.status = 'active' where session.status = 'scheduled' group by session.id, room.capacity having count(enrolment.id) > room.capacity) as sessions"
    );

    assert.equal(rooms.rows[0].count, 12);
    assert.equal(fractionalCredits.rows[0].count, 0);
    assert.equal(invalidSessions.rows[0].count, 0);
    assert.equal(roomOverlaps.rows[0].count, 0);
    assert.equal(closedTimeSessions.rows[0].count, 0);
    assert.equal(ownEnrolments.rows[0].count, 0);
    assert.equal(overCapacitySessions.rows[0].count, 0);

    await client.query(
      "insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits) values (1, 3, 'fitness', 'standard', 'scheduled', '2030-01-07 14:00:00+00', '2030-01-07 15:00:00+00', 40, 20)"
    );

    await assert.rejects(
      client.query(
        "insert into session (room_id, coach_id, discipline, session_type, status, starts_at, ends_at, room_fee_credits, seat_fee_credits) values (1, 6, 'fitness', 'standard', 'scheduled', '2030-01-07 14:30:00+00', '2030-01-07 15:30:00+00', 40, 20)"
      )
    );
  } finally {
    await client.end();
  }
});
