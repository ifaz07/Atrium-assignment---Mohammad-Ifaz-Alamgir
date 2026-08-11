import { Router } from 'express';
import { query, withTransaction } from '../db';
import { requireSession } from '../auth';
import { hoursOfNotice, refundAmount, refundPercent, roomFee, seatFee } from '../credits';

const router = Router();

const UPDATABLE_FIELDS = [
  'room_id',
  'coach_id',
  'discipline',
  'session_type',
  'status',
  'starts_at',
  'ends_at'
];

router.get('/', async (req, res) => {
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

      feed.push({
        ...session,
        room_name: rooms.length > 0 ? rooms[0].name : null,
        room_capacity: capacity,
        coach_name: coaches.length > 0 ? coaches[0].full_name : null,
        enrolled_count: taken,
        places_remaining: capacity - taken
      });
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
    const attendees = await query(
      `select e.id, e.status, e.credits_charged, e.credits_refunded, e.enrolled_at, e.cancelled_at,
              p.id as person_id, p.full_name, p.email
         from enrolment e
         join person p on p.id = e.person_id
        where e.session_id = $1
        order by e.id`,
      [id]
    );

    res.json({
      ...session,
      room: rooms.length > 0 ? rooms[0] : null,
      coach: coaches.length > 0 ? coaches[0] : null,
      attendees
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the session' });
  }
});

router.post('/', requireSession, async (req, res) => {
  try {
    const body = req.body || {};
    const { room_id, coach_id, discipline, session_type, starts_at, ends_at } = body;

    if (!room_id || !coach_id || !discipline || !session_type || !starts_at || !ends_at) {
      res.status(400).json({
        error: 'room_id, coach_id, discipline, session_type, starts_at and ends_at are all required'
      });
      return;
    }

    const rooms = await query('select id, name, capacity from room where id = $1', [room_id]);
    if (rooms.length === 0) {
      res.status(400).json({ error: 'no such room' });
      return;
    }

    const coaches = await query('select id, credits from person where id = $1', [coach_id]);
    if (coaches.length === 0) {
      res.status(400).json({ error: 'no such coach' });
      return;
    }

    const clashes = await query(
      `select id, starts_at, ends_at
         from session
        where room_id = $1
          and starts_at <= $3
          and ends_at >= $2
        limit 1`,
      [room_id, starts_at, ends_at]
    );

    if (clashes.length > 0) {
      res.status(409).json({ error: `${rooms[0].name} is already booked for that time` });
      return;
    }

    const fee = roomFee(session_type);
    const seat = seatFee(session_type);

    const created = await withTransaction(async (client) => {
      const inserted = await client.query(
        `insert into session
           (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
            room_fee_credits, seat_fee_credits)
         values ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8)
         returning *`,
        [room_id, coach_id, discipline, session_type, starts_at, ends_at, fee, seat]
      );

      await client.query('update person set credits = credits - $1 where id = $2', [fee, coach_id]);

      return inserted.rows[0];
    });

    res.status(201).json(created);
  } catch (err) {
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

    const body = req.body || {};

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

    const updated = await query(
      `update session set ${assignments.join(', ')} where id = $${params.length} returning *`,
      params
    );

    if (updated.length === 0) {
      res.status(404).json({ error: 'no such session' });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
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
        const refund = refundAmount(Number(enrolment.credits_charged), percent);

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
