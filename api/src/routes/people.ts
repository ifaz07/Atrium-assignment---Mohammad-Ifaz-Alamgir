import { Router } from 'express';
import { query } from '../db';
import { requireRole, requireSession } from '../auth';

const router = Router();

router.get('/', requireSession, requireRole('admin'), async (req, res) => {
  try {
    const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : null;

    const params: unknown[] = [];
    let sql = `select person.id, person.email, person.full_name, person.kind, person.credits, person.active,
                      (select count(*)::int from enrolment where enrolment.person_id = person.id) as enrolled_session_count,
                      (select count(*)::int from session where session.coach_id = person.id and session.status = 'scheduled') as running_session_count
                 from person`;

    if (kind) {
      params.push(kind);
      sql += ` where kind = $${params.length}`;
    }

    sql += ' order by person.full_name';

    const people = await query(sql, params);
    res.json(people);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not load the people' });
  }
});

export default router;
