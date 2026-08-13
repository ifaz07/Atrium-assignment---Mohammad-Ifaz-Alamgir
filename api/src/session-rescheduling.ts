import { DateTime } from 'luxon';
import { withTransaction } from './db';
import { CENTRE_TIMEZONE, hasRequiredCoachNotice, validateBookingTimes } from './booking';
import { queueEmail } from './email/outbox';
import { formatCentreDateTime } from './email/format';

export type RescheduleActor = { id: number; kind: 'admin' | 'coach' | 'participant' };

export class RescheduleError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const durationMinutes: Record<string, number> = { short: 45, standard: 60, intensive: 210 };

export function centreLocalDateTimeToIso(value: string): string | null {
  const parsed = DateTime.fromFormat(value.trim(), 'yyyy-MM-dd HH:mm', { zone: CENTRE_TIMEZONE });
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

export async function rescheduleSession(
  actor: RescheduleActor,
  id: number,
  input: { roomId?: unknown; startsAt?: unknown; discipline?: unknown }
) {
  if (actor.kind !== 'coach' && actor.kind !== 'admin') throw new RescheduleError(403, 'not allowed');

  return withTransaction(async (client) => {
    const existing = await client.query<{ id:number; coach_id:number; room_id:number; discipline:string; session_type:string; status:string; starts_at:Date }>(
      'select id,coach_id,room_id,discipline,session_type,status,starts_at from session where id=$1 for update', [id]
    );
    if (!existing.rowCount) throw new RescheduleError(404, 'no such session');
    const session = existing.rows[0];
    if (session.status !== 'scheduled') throw new RescheduleError(409, 'only a scheduled session can be rescheduled');
    if (actor.kind === 'coach' && session.coach_id !== actor.id) throw new RescheduleError(403, 'not allowed');

    const roomId = input.roomId === undefined ? session.room_id : Number(input.roomId);
    const startsAt = input.startsAt === undefined ? new Date(session.starts_at) : new Date(String(input.startsAt));
    if (!Number.isInteger(roomId) || roomId < 1 || Number.isNaN(startsAt.getTime())) {
      throw new RescheduleError(400, 'a valid room and start time are required');
    }
    const duration = durationMinutes[session.session_type];
    const endsAt = new Date(startsAt.getTime() + duration * 60 * 1000);
    const timeError = validateBookingTimes({ startsAt, endsAt, sessionType: session.session_type });
    if (timeError) throw new RescheduleError(400, timeError);
    if (actor.kind === 'coach' && !hasRequiredCoachNotice(startsAt)) {
      throw new RescheduleError(400, 'coaches must reschedule rooms at least 48 hours before the session starts');
    }
    const room = await client.query('select id from room where id=$1', [roomId]);
    if (!room.rowCount) throw new RescheduleError(400, 'no such room');

    // Every active attendee moves with this session.  Reject the whole move if
    // its new interval conflicts with any attendee or the coach's commitments.
    const conflicts = await client.query(
      `with affected_people as (
         select coach_id as person_id from session where id=$1
         union
         select person_id from enrolment where session_id=$1 and status='active'
       )
       select 1
         from affected_people affected
         join session other on other.coach_id=affected.person_id
          and other.id<>$1 and other.status='scheduled'
          and other.starts_at<$3 and other.ends_at>$2
       union all
       select 1
         from affected_people affected
         join enrolment other_enrolment on other_enrolment.person_id=affected.person_id and other_enrolment.status='active'
         join session other on other.id=other_enrolment.session_id
          and other.id<>$1 and other.status='scheduled'
          and other.starts_at<$3 and other.ends_at>$2
       limit 1`,
      [id, startsAt, endsAt]
    );
    if (conflicts.rowCount) throw new RescheduleError(409, 'the new time conflicts with the coach or an affected attendee');

    const nextDiscipline = typeof input.discipline === 'string' && input.discipline.trim() ? input.discipline.trim() : session.discipline;
    const updated = await client.query<{ id:number; discipline:string; room_id:number; starts_at:Date; ends_at:Date }>(
      'update session set room_id=$1,starts_at=$2,ends_at=$3,discipline=$4 where id=$5 returning id,discipline,room_id,starts_at,ends_at',
      [roomId, startsAt, endsAt, nextDiscipline, id]
    );
    const attendees = await client.query<{ id:number; email:string; full_name:string }>(
      `select p.id,p.email,p.full_name from enrolment e join person p on p.id=e.person_id
        where e.session_id=$1 and e.status='active'`, [id]
    );
    for (const attendee of attendees.rows) {
      await queueEmail(client, {
        recipient: attendee.email,
        subject: `Session updated: ${updated.rows[0].discipline}`,
        bodyText: `Hello ${attendee.full_name}, your ${updated.rows[0].discipline} session has moved to ${formatCentreDateTime(updated.rows[0].starts_at)} and ends at ${formatCentreDateTime(updated.rows[0].ends_at)}.`,
        eventKey: `session-rescheduled:${id}:${updated.rows[0].starts_at.toISOString()}:attendee:${attendee.id}`
      });
    }
    return { ...updated.rows[0], participants_moved: attendees.rowCount };
  }, 'serializable');
}
