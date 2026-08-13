import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db';
import { queueEmail } from '../email/outbox';

export const CENTRE_TIMEZONE = process.env.CENTRE_TIMEZONE || 'America/New_York';

export function centreDayWindow(centreDate: string, timezone = CENTRE_TIMEZONE): { start: Date; end: Date } {
  const start = DateTime.fromISO(centreDate, { zone: timezone }).startOf('day');
  if (!start.isValid) throw new Error('centreDate must be an ISO date');
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
}

function displayTime(value: Date, timezone: string): string {
  return DateTime.fromJSDate(value, { zone: 'utc' }).setZone(timezone).toFormat('HH:mm');
}

async function queueCoachDigests(client: PoolClient, centreDate: string, start: Date, end: Date): Promise<void> {
  const rows = await client.query<{
    coach_id: number;
    email: string;
    full_name: string;
    discipline: string;
    starts_at: Date;
    room_name: string;
    role: string;
  }>(
    `select person.id as coach_id, person.email, person.full_name, session.discipline,
            session.starts_at, room.name as room_name, 'teaching' as role
       from person join session on session.coach_id = person.id join room on room.id = session.room_id
      where person.kind = 'coach' and person.active = true and session.status = 'scheduled'
        and session.starts_at >= $1 and session.starts_at < $2
     union all
     select person.id, person.email, person.full_name, session.discipline,
            session.starts_at, room.name, 'attending'
       from person join enrolment on enrolment.person_id = person.id
       join session on session.id = enrolment.session_id join room on room.id = session.room_id
      where person.kind = 'coach' and person.active = true and enrolment.status = 'active'
        and session.status = 'scheduled' and session.starts_at >= $1 and session.starts_at < $2
      order by coach_id, starts_at`,
    [start, end]
  );

  const grouped = new Map<number, typeof rows.rows>();
  for (const row of rows.rows) grouped.set(row.coach_id, [...(grouped.get(row.coach_id) ?? []), row]);

  for (const [coachId, bookings] of grouped) {
    const coach = bookings[0];
    const lines = bookings.map((booking) => `${displayTime(booking.starts_at, CENTRE_TIMEZONE)} - ${booking.discipline} in ${booking.room_name} (${booking.role})`);
    await queueEmail(client, {
      recipient: coach.email,
      subject: `Your Atrium schedule for ${centreDate}`,
      bodyText: `Hello ${coach.full_name},\n\n${lines.join('\n')}`,
      eventKey: `coach-digest:${centreDate}:${coachId}`
    });
  }
}

async function queueAdministratorDigest(client: PoolClient, centreDate: string, start: Date, end: Date): Promise<void> {
  const sessions = await client.query<{
    id: number;
    discipline: string;
    starts_at: Date;
    room_name: string;
    coach_name: string;
    attendees: number;
    checked_in: number;
  }>(
    `select session.id, session.discipline, session.starts_at, room.name as room_name,
            coach.full_name as coach_name,
            count(enrolment.id) filter (where enrolment.status = 'active')::int as attendees,
            count(check_in.id)::int as checked_in
       from session join room on room.id = session.room_id join person coach on coach.id = session.coach_id
       left join enrolment on enrolment.session_id = session.id
       left join check_in on check_in.enrolment_id = enrolment.id
      where session.status = 'scheduled' and session.starts_at >= $1 and session.starts_at < $2
      group by session.id, room.id, coach.id order by session.starts_at`,
    [start, end]
  );
  const administrators = await client.query<{ id: number; email: string; full_name: string }>(
    "select id, email, full_name from person where kind = 'admin' and active = true"
  );
  const lines = sessions.rows.length === 0
    ? ['No sessions are scheduled.']
    : sessions.rows.map((session) => `${displayTime(session.starts_at, CENTRE_TIMEZONE)} - ${session.discipline}, ${session.room_name}, ${session.coach_name}, ${session.attendees} booked, ${session.checked_in} checked in`);

  for (const administrator of administrators.rows) {
    await queueEmail(client, {
      recipient: administrator.email,
      subject: `Atrium daily digest for ${centreDate}`,
      bodyText: `Hello ${administrator.full_name},\n\n${lines.join('\n')}`,
      eventKey: `admin-digest:${centreDate}:${administrator.id}`
    });
  }
}

export async function queueDailyDigests(centreDate = DateTime.now().setZone(CENTRE_TIMEZONE).toISODate()): Promise<boolean> {
  if (!centreDate) throw new Error('could not determine the centre date');
  const { start, end } = centreDayWindow(centreDate);

  return withTransaction(async (client) => {
    const claimed = await client.query(
      `insert into scheduled_job_run (job_name, centre_date)
       values ('daily-digests', $1) on conflict do nothing returning centre_date`,
      [centreDate]
    );
    if (claimed.rowCount === 0) return false;
    await queueCoachDigests(client, centreDate, start, end);
    await queueAdministratorDigest(client, centreDate, start, end);
    return true;
  });
}
