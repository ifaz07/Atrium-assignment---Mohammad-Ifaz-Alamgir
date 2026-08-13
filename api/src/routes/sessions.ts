import { Router } from 'express';
import { query, withTransaction } from '../db';
import { optionalSession, requireRole, requireSession } from '../auth';
import { hoursOfNotice, participantRefundPercent, refundAmount, refundPercent, roomFee, seatFee } from '../credits';
import { hasRequiredCoachNotice, validateBookingTimes } from '../booking';
import { queueAdministrators, queueEmail } from '../email/outbox';
import { formatCentreDateTime } from '../email/format';
import { RescheduleError, rescheduleSession } from '../session-rescheduling';

const router = Router();

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

router.get('/catalogue/available', optionalSession, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : new Date().toISOString();
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' } | undefined;
    const params: unknown[] = [from];
    let filters = "session.status = 'scheduled' and session.starts_at >= $1";

    if (to) {
      params.push(to);
      filters += ` and session.starts_at < $${params.length}`;
    }

    if (person?.kind === 'coach') {
      params.push(person.id);
      filters += ` and session.coach_id <> $${params.length}`;
    }

    const sessions = await query(
      `select session.id, session.discipline, session.session_type, session.starts_at, session.ends_at,
              session.seat_fee_credits, room.name as room_name, room.capacity as room_capacity,
              count(enrolment.id)::int as enrolled_count,
              room.capacity - count(enrolment.id)::int as places_remaining
         from session
         join room on room.id = session.room_id
         left join enrolment on enrolment.session_id = session.id and enrolment.status = 'active'
        where ${filters}
        group by session.id, room.id
        order by session.starts_at
        limit 200`,
      params
    );

    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load available sessions' });
  }
});

router.get('/:id(\\d+)', requireSession, async (req, res) => {
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

router.get('/mine/enrolments', requireSession, async (_req, res) => {
  try {
    const person = res.locals.person as { id: number };
    const enrolments = await query(
      `select enrolment.id, enrolment.status, enrolment.credits_charged, enrolment.credits_refunded,
              enrolment.enrolled_at, enrolment.cancelled_at, session.id as session_id, session.discipline,
              session.session_type, session.starts_at, session.ends_at, room.name as room_name
         from enrolment join session on session.id = enrolment.session_id join room on room.id = session.room_id
        where enrolment.person_id = $1 order by session.starts_at`,
      [person.id]
    );
    res.json(enrolments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load your bookings' });
  }
});

router.post('/:id/enrolments', requireSession, requireRole('participant', 'coach'), async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      res.status(404).json({ error: 'no such session' });
      return;
    }
    const person = res.locals.person as { id: number };
    const enrolment = await withTransaction(async (client) => {
      const sessions = await client.query<{ id: number; coach_id: number; status: string; starts_at: Date; ends_at: Date; seat_fee_credits: number; capacity: number; discipline: string; coach_email: string }>(
        `select session.id, session.coach_id, session.status, session.starts_at, session.ends_at,
                session.seat_fee_credits, session.discipline, room.capacity, coach.email as coach_email
           from session join room on room.id = session.room_id
           join person coach on coach.id = session.coach_id where session.id = $1 for update`,
        [sessionId]
      );
      if (sessions.rowCount === 0) throw new BookingError(404, 'no such session');
      const session = sessions.rows[0];
      if (session.status !== 'scheduled' || new Date(session.starts_at) <= new Date()) throw new BookingError(409, 'this session is not available to book');
      if (session.coach_id === person.id) throw new BookingError(403, 'a coach cannot enrol in their own session');
      const attendee = await client.query<{ credits: number; full_name: string }>('select credits, full_name from person where id = $1 and active = true for update', [person.id]);
      if (attendee.rowCount === 0) throw new BookingError(403, 'your account is not active');
      if (attendee.rows[0].credits < session.seat_fee_credits) throw new BookingError(409, 'insufficient credits to book this session');
      const existing = await client.query("select id from enrolment where session_id = $1 and person_id = $2 and status = 'active'", [sessionId, person.id]);
      if (existing.rows.length > 0) throw new BookingError(409, 'you already have a place in this session');
      const commitments = await client.query(
        `select id from session where coach_id = $3 and status = 'scheduled' and starts_at < $2 and ends_at > $1
         union all select enrolment.id from enrolment join session on session.id = enrolment.session_id
          where enrolment.person_id = $3 and enrolment.status = 'active' and session.status = 'scheduled' and session.starts_at < $2 and session.ends_at > $1 limit 1`,
        [session.starts_at, session.ends_at, person.id]
      );
      if (commitments.rows.length > 0) throw new BookingError(409, 'you already have a commitment during that time');
      const capacity = await client.query<{ count: number }>("select count(*)::int as count from enrolment where session_id = $1 and status = 'active'", [sessionId]);
      if (capacity.rows[0].count >= session.capacity) throw new BookingError(409, 'this session is full');
      const inserted = await client.query(
        "insert into enrolment (session_id, person_id, status, credits_charged, credits_refunded, enrolled_at) values ($1, $2, 'active', $3, 0, now()) returning *",
        [sessionId, person.id, session.seat_fee_credits]
      );
      await client.query('update person set credits = credits - $1 where id = $2', [session.seat_fee_credits, person.id]);
      await queueEmail(client, {
        recipient: session.coach_email,
        subject: `New booking for ${session.discipline}`,
        bodyText: `${attendee.rows[0].full_name} booked a place in your ${session.discipline} session on ${formatCentreDateTime(session.starts_at)}.`,
        eventKey: `enrolment-created:${inserted.rows[0].id}:coach`
      });
      return inserted.rows[0];
    }, 'serializable');
    res.status(201).json(enrolment);
  } catch (err) {
    if (err instanceof BookingError) { res.status(err.status).json({ error: err.message }); return; }
    if ((err as { code?: string }).code === '40001' || (err as { code?: string }).code === '23505') { res.status(409).json({ error: 'this booking could not be completed; please try again' }); return; }
    console.error(err); res.status(500).json({ error: 'could not book this session' });
  }
});

router.post('/:id/enrolments/cancel', requireSession, requireRole('participant', 'coach'), async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const person = res.locals.person as { id: number };
    const cancelled = await withTransaction(async (client) => {
      const enrolments = await client.query<{ id: number; credits_charged: number; starts_at: Date; discipline: string; coach_email: string; attendee_name: string }>(
        `select enrolment.id, enrolment.credits_charged, session.starts_at, session.discipline,
                coach.email as coach_email, attendee.full_name as attendee_name
           from enrolment join session on session.id = enrolment.session_id
           join person coach on coach.id = session.coach_id join person attendee on attendee.id = enrolment.person_id
          where enrolment.session_id = $1 and enrolment.person_id = $2 and enrolment.status = 'active' for update`, [sessionId, person.id]
      );
      if (enrolments.rowCount === 0) throw new BookingError(404, 'you do not have an active booking for this session');
      const enrolment = enrolments.rows[0];
      const percent = participantRefundPercent(hoursOfNotice(new Date(), new Date(enrolment.starts_at)));
      const refund = refundAmount(enrolment.credits_charged, percent);
      await client.query("update enrolment set status = 'cancelled', credits_refunded = $1, cancelled_at = now() where id = $2", [refund, enrolment.id]);
      await client.query('update person set credits = credits + $1 where id = $2', [refund, person.id]);
      await queueEmail(client, {
        recipient: enrolment.coach_email,
        subject: `Booking cancelled for ${enrolment.discipline}`,
        bodyText: `${enrolment.attendee_name} cancelled their place in your ${enrolment.discipline} session. ${refund} credits were refunded.`,
        eventKey: `enrolment-cancelled:${enrolment.id}:coach`
      });
      return { refund, percent };
    }, 'serializable');
    res.json({ session_id: sessionId, status: 'cancelled', refund_percent: cancelled.percent, credits_refunded: cancelled.refund });
  } catch (err) {
    if (err instanceof BookingError) { res.status(err.status).json({ error: err.message }); return; }
    console.error(err); res.status(500).json({ error: 'could not cancel this booking' });
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

      const coach = await client.query<{ id: number; credits: number; full_name: string }>(
        "select id, credits, full_name from person where id = $1 and kind = 'coach' and active = true for update",
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

      await queueAdministrators(client, {
        subject: `Room booked for ${discipline}`,
        bodyText: `${coach.rows[0].full_name} booked ${room.rows[0].name} for ${discipline} on ${formatCentreDateTime(start)}.`
      }, `session-created:${inserted.rows[0].id}`);

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
    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' };
    const body = req.body || {};
    if (body.room_id === undefined && body.starts_at === undefined && body.discipline === undefined) {
      res.status(400).json({ error: 'provide a room, start time, or discipline to update' });
      return;
    }
    const updated = await rescheduleSession(person, id, {
      roomId: body.room_id,
      startsAt: body.starts_at,
      discipline: body.discipline
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof RescheduleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
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

    const person = res.locals.person as { id: number; kind: 'admin' | 'coach' | 'participant' };

    const summary = await withTransaction(async (client) => {
      const sessions = await client.query<{
        coach_id: number;
        status: string;
        discipline: string;
        starts_at: Date;
        room_fee_credits: number;
      }>('select coach_id, status, discipline, starts_at, room_fee_credits from session where id = $1 for update', [id]);
      if (sessions.rowCount === 0) throw new BookingError(404, 'no such session');
      const session = sessions.rows[0];
      if (person.kind !== 'admin' && (person.kind !== 'coach' || person.id !== session.coach_id)) {
        throw new BookingError(403, 'not allowed');
      }
      if (session.status === 'cancelled') throw new BookingError(409, 'that session is already cancelled');
      const percent = refundPercent(hoursOfNotice(new Date(), new Date(session.starts_at)));
      const roomRefund = refundAmount(Number(session.room_fee_credits), percent);
      const enrolments = await client.query<{ id: number; person_id: number; credits_charged: number; email: string; full_name: string }>(
        `select enrolment.id, enrolment.person_id, enrolment.credits_charged, person.email, person.full_name
           from enrolment join person on person.id = enrolment.person_id
          where enrolment.session_id = $1 and enrolment.status = 'active'`,
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

        await queueEmail(client, {
          recipient: enrolment.email,
          subject: `Session cancelled: ${session.discipline}`,
          bodyText: `Hello ${enrolment.full_name}, the ${session.discipline} session scheduled for ${formatCentreDateTime(session.starts_at)} was cancelled. Your full payment of ${refund} credits has been refunded.`,
          eventKey: `session-cancelled:${id}:attendee:${enrolment.person_id}`
        });

        seatsRefunded += refund;
      }

      await client.query('update person set credits = credits + $1 where id = $2', [
        roomRefund,
        session.coach_id
      ]);

      await client.query("update session set status = 'cancelled' where id = $1", [id]);

      await queueAdministrators(client, {
        subject: `Room booking cancelled: ${session.discipline}`,
        bodyText: `The ${session.discipline} session scheduled for ${formatCentreDateTime(session.starts_at)} was cancelled. ${enrolments.rowCount} active attendees were fully refunded.`
      }, `session-cancelled:${id}`);

      return { enrolments: enrolments.rowCount, seatsRefunded, percent, roomRefund };
    });

    res.json({
      id,
      status: 'cancelled',
      refund_percent: summary.percent,
      room_fee_refunded: summary.roomRefund,
      enrolments_cancelled: summary.enrolments,
      seat_fees_refunded: summary.seatsRefunded
    });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
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
