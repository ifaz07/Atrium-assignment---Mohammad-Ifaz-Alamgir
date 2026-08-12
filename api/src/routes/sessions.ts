import { Router } from 'express';
import { query, withTransaction } from '../db';
import { optionalSession, requireRole, requireSession } from '../auth';
import { hoursOfNotice, refundAmount, refundPercent, roomFee, seatFee } from '../credits';
import { hasRequiredCoachNotice, validateBookingTimes } from '../booking';

const router = Router();

const UPDATABLE_FIELDS = [
  'room_id',
  'discipline',
  'starts_at',
  'ends_at'
];

function overlapsClause(sessionAlias: string = 'session'): string {
  return `${sessionAlias}.starts_at < $2 and ${sessionAlias}.ends_at > $1`;
}

router.get('/', optionalSession, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : new Date().toISOString();
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;

    const params: unknown[] = [from];
    let sql = `select id, room_id, coach_id, discipline, session_type, status,
                      starts_at, ends_at, room_fee_credits, seat_fee_credits
                 from session
                where starts_at >= $1
                  and status <> 'cancelled'`;

    if (to) {
      params.push(to);
      sql += ` and starts_at < $${params.length}`;
    }

    sql += ' order by starts_at';

    const sessions = await query(sql, params);
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' } | undefined;
    const feed = [];

    for (const session of sessions) {
      const rooms = await query('select id, name, capacity from room where id = $1', [session.room_id]);
      const coaches = await query('select id, full_name from person where id = $1', [session.coach_id]);
      const enrolled = await query(
        "select count(*)::int as count from enrolment where session_id = $1 and status = 'active'",
        [session.id]
      );

      const capacity = rooms.length > 0 ? rooms[0].capacity : 0;
      const taken = enrolled[0].count;

      const catalogueEntry = {
        id: session.id,
        discipline: session.discipline,
        session_type: session.session_type,
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        room_fee_credits: session.room_fee_credits,
        seat_fee_credits: session.seat_fee_credits,
        room_name: rooms.length > 0 ? rooms[0].name : null,
        room_capacity: capacity,
        enrolled_count: taken,
        places_remaining: capacity - taken
      };

      if (person?.kind === 'admin') {
        feed.push({
          ...catalogueEntry,
          room_id: session.room_id,
          coach_id: session.coach_id,
          coach_name: coaches.length > 0 ? coaches[0].full_name : null,
          status: session.status
        });
      } else if (person?.kind === 'coach' && person.id !== session.coach_id) {
        feed.push({ id: session.id, starts_at: session.starts_at, ends_at: session.ends_at, busy: true });
      } else {
        feed.push(catalogueEntry);
      }
    }

    res.json(feed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the calendar' });
  }
});

router.get('/:id', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const sessions = await query('select * from session where id = $1', [id]);

    if (sessions.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const session = sessions[0];
    const rooms = await query('select id, name, capacity from room where id = $1', [session.room_id]);
    const coaches = await query('select id, full_name, email from person where id = $1', [session.coach_id]);
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' };

    if (person.kind === 'coach' && person.id !== session.coach_id) {
      res.json({ id: session.id, starts_at: session.starts_at, ends_at: session.ends_at, busy: true });
      return;
    }

    const response: Record<string, unknown> = {
      id: session.id,
      discipline: session.discipline,
      session_type: session.session_type,
      status: session.status,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      room_fee_credits: session.room_fee_credits,
      seat_fee_credits: session.seat_fee_credits,
      room: rooms.length > 0 ? rooms[0] : null,
      coach: coaches.length > 0 ? { id: coaches[0].id, full_name: coaches[0].full_name } : null
    };

    if (person.kind === 'admin' || (person.kind === 'coach' && person.id === session.coach_id)) {
      const attendees = await query(
        `select e.id, e.status, e.credits_charged, e.credits_refunded, e.enrolled_at, e.cancelled_at,
                p.id as person_id, p.full_name, p.email
           from enrolment e
           join person p on p.id = e.person_id
          where e.session_id = $1
          order by e.id`,
        [id]
      );
      response.attendees = attendees;
    }

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the session' });
  }
});

router.post('/', requireSession, requireRole('admin', 'coach'), async (req, res) => {
  try {
    const body = req.body || {};
    const { room_id, coach_id, discipline, session_type, starts_at, ends_at } = body;
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' };
    const effectiveCoachId = person.kind === 'coach' ? person.id : coach_id;

    if (!room_id || !effectiveCoachId || !discipline || !session_type || !starts_at || !ends_at) {
      res.status(400).json({
        error: 'room_id, coach_id, discipline, session_type, starts_at and ends_at are all required'
      });
      return;
    }

    const start = new Date(starts_at);
    const end = new Date(ends_at);
    const timeError = validateBookingTimes({ startsAt: start, endsAt: end, sessionType: String(session_type) });
    if (timeError) {
      res.status(400).json({ error: timeError });
      return;
    }
    if (person.kind === 'coach' && !hasRequiredCoachNotice(start)) {
      res.status(400).json({ error: 'coaches must book rooms at least 48 hours before the session starts' });
      return;
    }

    const fee = roomFee(session_type);
    const seat = seatFee(session_type);

    const created = await withTransaction(async (client) => {
      const room = await client.query<{ id: number; name: string }>('select id, name from room where id = $1', [room_id]);
      if (room.rowCount === 0) throw new BookingError(400, 'no such room');

      const coach = await client.query<{ id: number; credits: number }>(
        "select id, credits from person where id = $1 and kind = 'coach' and active = true for update",
        [effectiveCoachId]
      );
      if (coach.rowCount === 0) throw new BookingError(400, 'no such coach');
      if (coach.rows[0].credits < fee) throw new BookingError(409, 'insufficient credits to book this room');

      const commitments = await client.query(
        `select id from session
          where coach_id = $3 and status = 'scheduled' and ${overlapsClause()}
         union all
         select enrolment.id from enrolment
           join session on session.id = enrolment.session_id
          where enrolment.person_id = $3 and enrolment.status = 'active' and session.status = 'scheduled'
            and ${overlapsClause()}
         limit 1`,
        [starts_at, ends_at, effectiveCoachId]
      );
      if (commitments.rows.length > 0) throw new BookingError(409, 'you already have a commitment during that time');

      const inserted = await client.query(
        `insert into session
           (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
            room_fee_credits, seat_fee_credits)
         values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)
         returning *`,
        [room_id, effectiveCoachId, discipline, session_type, starts_at, ends_at, fee, seat]
      );

      await client.query('update person set credits = credits - $1 where id = $2', [fee, effectiveCoachId]);

      return inserted.rows[0];
    }, 'serializable');

    res.status(201).json(created);
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if ((err as { code?: string }).code === '23P01' || (err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'that room is already booked for that time' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'could not create the session' });
  }
});

router.patch('/:id', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const existing = await query('select * from session where id = $1', [id]);
    if (existing.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' };
    if (person.kind !== 'admin' && (person.kind !== 'coach' || person.id !== existing[0].coach_id)) {
      res.status(403).json({ error: 'not allowed' });
      return;
    }

    const body = req.body || {};

    const nextRoomId = body.room_id ?? existing[0].room_id;
    const nextStartsAt = body.starts_at ?? existing[0].starts_at;
    const nextEndsAt = body.ends_at ?? existing[0].ends_at;
    const timeError = validateBookingTimes({
      startsAt: new Date(nextStartsAt),
      endsAt: new Date(nextEndsAt),
      sessionType: existing[0].session_type
    });
    if (timeError) {
      res.status(400).json({ error: timeError });
      return;
    }
    if (person.kind === 'coach' && !hasRequiredCoachNotice(new Date(nextStartsAt))) {
      res.status(400).json({ error: 'coaches must book rooms at least 48 hours before the session starts' });
      return;
    }

    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const field of UPDATABLE_FIELDS) {
      if (body[field] !== undefined) {
        params.push(body[field]);
        assignments.push(`${field} = $${params.length}`);
      }
    }

    if (assignments.length === 0) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }

    params.push(id);

    const updated = await withTransaction(async (client) => {
      const room = await client.query('select id from room where id = $1', [nextRoomId]);
      if (room.rowCount === 0) throw new BookingError(400, 'no such room');
      const commitments = await client.query(
        `select id from session where coach_id = $3 and id <> $4 and status = 'scheduled' and ${overlapsClause()}
         union all
         select enrolment.id from enrolment join session on session.id = enrolment.session_id
          where enrolment.person_id = $3 and enrolment.status = 'active' and session.status = 'scheduled' and session.id <> $4
            and ${overlapsClause()}
         limit 1`,
        [nextStartsAt, nextEndsAt, existing[0].coach_id, id]
      );
      if (commitments.rows.length > 0) throw new BookingError(409, 'the coach already has a commitment during that time');
      const result = await client.query(
        `update session set ${assignments.join(', ')} where id = $${params.length} returning *`,
        params
      );
      return result.rows;
    }, 'serializable');

    if (updated.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if ((err as { code?: string }).code === '23P01' || (err as { code?: string }).code === '40001') {
      res.status(409).json({ error: 'that room is already booked for that time' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'could not update the session' });
  }
});

router.post('/:id/cancel', requireSession, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const sessions = await query('select * from session where id = $1', [id]);

    if (sessions.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    const session = sessions[0];
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' };
    if (person.kind !== 'admin' && (person.kind !== 'coach' || person.id !== session.coach_id)) {
      res.status(403).json({ error: 'not allowed' });
      return;
    }
    if (session.status === 'cancelled') {
      res.status(409).json({ error: 'that session is already cancelled' });
      return;
    }

    const percent = refundPercent(hoursOfNotice(new Date(), new Date(session.starts_at)));
    const roomRefund = refundAmount(Number(session.room_fee_credits), percent);

    const summary = await withTransaction(async (client) => {
      const enrolments = await client.query(
        "select id, person_id, credits_charged from enrolment where session_id = $1 and status = 'active'",
        [id]
      );

      let seatsRefunded = 0;

      for (const enrolment of enrolments.rows) {
        const refund = Number(enrolment.credits_charged);

        await client.query(
          `update enrolment
              set status = 'cancelled', credits_refunded = $1, cancelled_at = now()
            where id = $2`,
          [refund, enrolment.id]
        );

        await client.query('update person set credits = credits + $1 where id = $2', [
          refund,
          enrolment.person_id
        ]);

        seatsRefunded += refund;
      }

      await client.query('update person set credits = credits + $1 where id = $2', [
        roomRefund,
        session.coach_id
      ]);

      await client.query("update session set status = 'cancelled' where id = $1", [id]);

      return { enrolments: enrolments.rowCount, seatsRefunded };
    });

    res.json({
      id,
      status: 'cancelled',
      refund_percent: percent,
      room_fee_refunded: roomRefund,
      enrolments_cancelled: summary.enrolments,
      seat_fees_refunded: summary.seatsRefunded
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not cancel the session' });
  }
});

export default router;

class BookingError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
