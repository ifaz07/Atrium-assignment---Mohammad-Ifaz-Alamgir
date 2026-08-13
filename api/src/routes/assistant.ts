import { Router } from 'express';
import crypto from 'node:crypto';
import { optionalSession, SessionPerson } from '../auth';
import { createSetupToken, hashSetupToken } from '../account-setup';
import { query, withTransaction } from '../db';
import { queueAdministrators, queueEmail } from '../email/outbox';
import { formatCentreDateTime } from '../email/format';
import { participantRefundPercent, hoursOfNotice, refundAmount, refundPercent } from '../credits';
import { centreLocalDateTimeToIso, RescheduleError, rescheduleSession } from '../session-rescheduling';

type Actor = SessionPerson | null;
type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
const router = Router();

function denied(): ToolResult { return { ok: false, error: 'You are not allowed to access that information.' }; }
function sessionIdFrom(text: string): number | null {
  const match = text.match(/(?:session|booking)\s*(?:id)?\s*#?\s*<?\s*(\d+)/i) || text.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}
function emailFrom(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

async function catalogue(): Promise<ToolResult> {
  const rows = await query(
    `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at, s.seat_fee_credits,
            r.name as room_name, r.capacity - count(e.id)::int as places_remaining
       from session s join room r on r.id = s.room_id
       left join enrolment e on e.session_id = s.id and e.status = 'active'
      where s.status = 'scheduled' and s.starts_at > now()
      group by s.id, r.id order by s.starts_at limit 30`
  );
  return { ok: true, data: rows };
}

async function publicSession(id: number): Promise<ToolResult> {
  const rows = await query<{id:number;discipline:string;session_type:string;starts_at:string;ends_at:string;seat_fee_credits:number;room_name:string;places_remaining:number}>(
    `select s.id,s.discipline,s.session_type,s.starts_at,s.ends_at,s.seat_fee_credits,r.name room_name,
            r.capacity-count(e.id)::int places_remaining
       from session s join room r on r.id=s.room_id left join enrolment e on e.session_id=s.id and e.status='active'
      where s.id=$1 and s.status='scheduled' group by s.id,r.id`, [id]
  );
  return rows[0] ? { ok:true,data:rows[0] } : { ok:false,error:'That session is not available.' };
}

async function myBookings(actor: Actor): Promise<ToolResult> {
  if (!actor) return denied();
  const rows = await query(
    `select e.session_id, e.status, e.credits_charged, e.credits_refunded, s.discipline, s.starts_at, s.ends_at, r.name room_name
       from enrolment e join session s on s.id=e.session_id join room r on r.id=s.room_id
      where e.person_id=$1 order by s.starts_at`, [actor.id]
  );
  return { ok: true, data: rows };
}

async function myCredits(actor: Actor): Promise<ToolResult> {
  if (!actor) return denied();
  const rows = await query<{ credits: number }>('select credits from person where id=$1 and active=true', [actor.id]);
  return rows[0] ? { ok: true, data: { credits: rows[0].credits } } : denied();
}

async function adminPersonLookup(actor: Actor, name: string): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  const rows = await query<{full_name:string;email:string;kind:string;credits:number;active:boolean}>(
    `select full_name,email,kind,credits,active from person
      where lower(full_name) like lower($1) or lower(email) like lower($1)
      order by full_name limit 20`, [`%${name}%`]
  );
  return { ok:true, data:rows };
}

async function adminUserSummary(actor: Actor): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  const rows = await query<{kind:string;count:number}>("select kind,count(*)::int count from person group by kind order by kind");
  return { ok:true, data:rows };
}

async function adminPeople(actor: Actor, kind?: string): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  const validKind = kind === 'participant' || kind === 'coach' || kind === 'admin' ? kind : null;
  const rows = await query<{full_name:string;email:string;kind:string;credits:number;active:boolean;booking_count:number;teaching_count:number}>(
    `select p.full_name,p.email,p.kind,p.credits,p.active,
       (select count(*)::int from enrolment e where e.person_id=p.id and e.status='active') booking_count,
       (select count(*)::int from session s where s.coach_id=p.id and s.status='scheduled') teaching_count
     from person p ${validKind ? 'where p.kind=$1' : ''} order by p.kind,p.full_name limit 100`,
    validKind ? [validKind] : []
  );
  return { ok:true, data:rows };
}

async function adminBookings(actor: Actor, personQuery?: string): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  const params = personQuery ? [`%${personQuery}%`] : [];
  const rows = await query<{session_id:number;full_name:string;email:string;status:string;credits_charged:number;credits_refunded:number;discipline:string;starts_at:string;room_name:string}>(
    `select e.session_id,p.full_name,p.email,e.status,e.credits_charged,e.credits_refunded,s.discipline,s.starts_at,r.name room_name
       from enrolment e join person p on p.id=e.person_id join session s on s.id=e.session_id join room r on r.id=s.room_id
       ${personQuery ? 'where lower(p.full_name) like lower($1) or lower(p.email) like lower($1)' : ''}
       order by s.starts_at desc limit 100`, params
  );
  return { ok:true, data:rows };
}

async function adminSetCredits(actor: Actor, personQuery: string, credits: number): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  if (!Number.isInteger(credits) || credits < 0 || credits > 1_000_000) return { ok:false, error:'Credits must be a whole number between 0 and 1000000.' };
  const rows = await query<{full_name:string;kind:string;credits:number}>(
    `update person set credits=$1 where id in (
       select id from person where lower(full_name)=lower($2) or lower(email)=lower($2) limit 1
     ) returning full_name,kind,credits`, [credits, personQuery.trim()]
  );
  return rows[0] ? { ok:true, data:rows[0] } : { ok:false, error:'No matching user was found. Use their full name or email address.' };
}

async function adminSetAccountStatus(actor: Actor, personQuery: string, active: boolean): Promise<ToolResult> {
  if (!actor || actor.kind !== 'admin') return denied();
  if (personQuery.trim().toLowerCase() === actor.email.toLowerCase()) return { ok:false, error:'You cannot change your own administrator access through the assistant.' };
  const rows = await query<{full_name:string;kind:string;active:boolean}>(
    `update person set active=$1 where id in (
       select id from person where lower(full_name)=lower($2) or lower(email)=lower($2) limit 1
     ) returning full_name,kind,active`, [active, personQuery.trim()]
  );
  return rows[0] ? { ok:true, data:rows[0] } : { ok:false, error:'No matching user was found. Use their full name or email address.' };
}

async function coachSessions(actor: Actor, sessionId?: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'coach' && actor.kind !== 'admin')) return denied();
  const params: unknown[] = actor.kind === 'admin' ? [] : [actor.id];
  let where = actor.kind === 'admin' ? 'true' : 's.coach_id = $1';
  if (sessionId) { params.push(sessionId); where += ` and s.id = $${params.length}`; }
  const rows = await query(`select s.id, s.discipline, s.status, s.starts_at, s.ends_at, r.name room_name
    from session s join room r on r.id=s.room_id where ${where} order by s.starts_at`, params);
  return { ok: true, data: rows };
}

async function attendees(actor: Actor, id: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'coach' && actor.kind !== 'admin')) return denied();
  const ownership = await query<{ id: number }>(`select id from session where id=$1 ${actor.kind === 'coach' ? 'and coach_id=$2' : ''}`, actor.kind === 'coach' ? [id, actor.id] : [id]);
  if (!ownership[0]) return denied();
  const rows = await query(
    `select p.full_name, e.status, e.cancelled_at, e.enrolled_at,
      (select count(*)::int from check_in ci join enrolment olde on olde.id=ci.enrolment_id join session olds on olds.id=olde.session_id where olde.person_id=p.id and olds.coach_id=(select coach_id from session where id=$1)) as attended_with_you
     from enrolment e join person p on p.id=e.person_id where e.session_id=$1 order by p.full_name`, [id]
  );
  return { ok: true, data: rows };
}

async function cancelledAttendees(actor: Actor, id: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'coach' && actor.kind !== 'admin')) return denied();
  const ownership = await query<{ id: number }>(`select id from session where id=$1 ${actor.kind === 'coach' ? 'and coach_id=$2' : ''}`, actor.kind === 'coach' ? [id, actor.id] : [id]);
  if (!ownership[0]) return denied();
  const rows = await query<{full_name:string;cancelled_at:string;credits_refunded:number}>(
    `select p.full_name,e.cancelled_at,e.credits_refunded from enrolment e join person p on p.id=e.person_id
      where e.session_id=$1 and e.status='cancelled' order by e.cancelled_at`, [id]
  );
  return { ok:true, data:rows };
}

async function enrol(actor: Actor, id: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'participant' && actor.kind !== 'coach')) return denied();
  try {
    const data = await withTransaction(async client => {
      const s = await client.query<{ coach_id:number; coach_email:string; status:string; starts_at:Date; ends_at:Date; seat_fee_credits:number; capacity:number; discipline:string }>(`select s.coach_id,coach.email coach_email,s.status,s.starts_at,s.ends_at,s.seat_fee_credits,r.capacity,s.discipline from session s join room r on r.id=s.room_id join person coach on coach.id=s.coach_id where s.id=$1 for update`, [id]);
      if (!s.rowCount || s.rows[0].status !== 'scheduled' || new Date(s.rows[0].starts_at) <= new Date()) throw new Error('unavailable');
      const session = s.rows[0]; if (session.coach_id === actor.id) throw new Error('own');
      const person = await client.query<{credits:number;full_name:string}>('select credits,full_name from person where id=$1 for update', [actor.id]);
      if (!person.rowCount || person.rows[0].credits < session.seat_fee_credits) throw new Error('credits');
      const count = await client.query<{count:number}>("select count(*)::int count from enrolment where session_id=$1 and status='active'", [id]);
      if (count.rows[0].count >= session.capacity) throw new Error('full');
      const conflict = await client.query(`select 1 from session where coach_id=$3 and status='scheduled' and starts_at<$2 and ends_at>$1 union all select 1 from enrolment e join session s on s.id=e.session_id where e.person_id=$3 and e.status='active' and s.status='scheduled' and s.starts_at<$2 and s.ends_at>$1 limit 1`, [session.starts_at, session.ends_at, actor.id]);
      if (conflict.rowCount) throw new Error('conflict');
      const inserted = await client.query(`insert into enrolment(session_id,person_id,status,credits_charged,credits_refunded,enrolled_at) values($1,$2,'active',$3,0,now()) returning id`, [id,actor.id,session.seat_fee_credits]);
      await client.query('update person set credits=credits-$1 where id=$2',[session.seat_fee_credits,actor.id]);
      await queueEmail(client,{ recipient:session.coach_email, subject:`New booking for ${session.discipline}`, bodyText:`${person.rows[0].full_name} booked a place in your ${session.discipline} session on ${formatCentreDateTime(session.starts_at)}.`, eventKey:`enrolment-created:${inserted.rows[0].id}:coach` });
      return { booking_id: inserted.rows[0].id, session: session.discipline, credits_charged: session.seat_fee_credits };
    }, 'serializable');
    return { ok:true, data };
  } catch { return { ok:false, error:'This booking cannot be completed. It may be full, unavailable, conflicting, or have insufficient credits.' }; }
}

async function cancelEnrolment(actor: Actor, id: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'participant' && actor.kind !== 'coach')) return denied();
  try {
    const data = await withTransaction(async client => {
      const rows = await client.query<{id:number;credits_charged:number;starts_at:Date;discipline:string;coach_email:string;attendee_name:string}>(`select e.id,e.credits_charged,s.starts_at,s.discipline,coach.email coach_email,person.full_name attendee_name from enrolment e join session s on s.id=e.session_id join person coach on coach.id=s.coach_id join person on person.id=e.person_id where e.session_id=$1 and e.person_id=$2 and e.status='active' for update`, [id,actor.id]);
      if (!rows.rowCount) throw new Error('missing');
      const refund = refundAmount(rows.rows[0].credits_charged, participantRefundPercent(hoursOfNotice(new Date(), new Date(rows.rows[0].starts_at))));
      await client.query("update enrolment set status='cancelled',credits_refunded=$1,cancelled_at=now() where id=$2",[refund,rows.rows[0].id]);
      await client.query('update person set credits=credits+$1 where id=$2',[refund,actor.id]);
      await queueEmail(client,{recipient:rows.rows[0].coach_email,subject:`Booking cancelled for ${rows.rows[0].discipline}`,bodyText:`${rows.rows[0].attendee_name} cancelled their place in your ${rows.rows[0].discipline} session. ${refund} credits were refunded.`,eventKey:`enrolment-cancelled:${rows.rows[0].id}:coach`});
      return { session_id:id, status:'cancelled', credits_refunded:refund };
    }, 'serializable');
    return { ok:true, data };
  } catch { return {ok:false,error:'You do not have an active booking for that session.'}; }
}

async function cancelOwnedSession(actor: Actor, id: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'coach' && actor.kind !== 'admin')) return denied();
  try {
    const data = await withTransaction(async client => {
      const rows = await client.query<{coach_id:number;status:string;discipline:string;starts_at:Date;room_fee_credits:number}>(`select coach_id,status,discipline,starts_at,room_fee_credits from session where id=$1 for update`,[id]);
      if (!rows.rowCount || (actor.kind === 'coach' && rows.rows[0].coach_id !== actor.id) || rows.rows[0].status === 'cancelled') throw new Error('denied');
      const enrolled = await client.query<{id:number;person_id:number;credits_charged:number;email:string;full_name:string}>("select e.id,e.person_id,e.credits_charged,p.email,p.full_name from enrolment e join person p on p.id=e.person_id where e.session_id=$1 and e.status='active' for update",[id]);
      for (const item of enrolled.rows) {
        await client.query("update enrolment set status='cancelled',credits_refunded=$1,cancelled_at=now() where id=$2",[item.credits_charged,item.id]);
        await client.query('update person set credits=credits+$1 where id=$2',[item.credits_charged,item.person_id]);
        await queueEmail(client,{recipient:item.email,subject:`Session cancelled: ${rows.rows[0].discipline}`,bodyText:`Hello ${item.full_name}, the ${rows.rows[0].discipline} session scheduled for ${formatCentreDateTime(rows.rows[0].starts_at)} was cancelled. Your full payment of ${item.credits_charged} credits has been refunded.`,eventKey:`session-cancelled:${id}:attendee:${item.person_id}`});
      }
      const roomRefund = refundAmount(rows.rows[0].room_fee_credits, refundPercent(hoursOfNotice(new Date(), new Date(rows.rows[0].starts_at))));
      await client.query('update person set credits=credits+$1 where id=$2',[roomRefund,rows.rows[0].coach_id]);
      await client.query("update session set status='cancelled' where id=$1",[id]);
      await queueAdministrators(client,{subject:`Room booking cancelled: ${rows.rows[0].discipline}`,bodyText:`The ${rows.rows[0].discipline} session scheduled for ${formatCentreDateTime(rows.rows[0].starts_at)} was cancelled. ${enrolled.rowCount} active attendees were fully refunded.`},`session-cancelled:${id}`);
      return {id,status:'cancelled',participants_refunded:enrolled.rowCount,room_fee_refunded:roomRefund};
    }, 'serializable');
    return {ok:true,data};
  } catch { return {ok:false,error:'You are not allowed to cancel that session.'}; }
}

async function rescheduleOwnedSession(actor: Actor, id: number, startsAt?: string, roomId?: number): Promise<ToolResult> {
  if (!actor || (actor.kind !== 'coach' && actor.kind !== 'admin')) return denied();
  if (!startsAt || !roomId) return {ok:false,error:'Use: “Reschedule session 123 to 2026-08-20 14:00 in room 2”. Times are America/New_York.'};
  try {
    const data = await rescheduleSession(actor, id, { roomId, startsAt });
    return {ok:true,data};
  } catch (error) {
    if (error instanceof RescheduleError) return { ok:false, error:error.message };
    return {ok:false,error:'The session could not be rescheduled.'};
  }
}

async function guestBooking(id: number, email: string): Promise<ToolResult> {
  try {
    const token = createSetupToken();
    const data = await withTransaction(async client => {
      const existing = await client.query<{id:number}>('select id from person where lower(email)=lower($1)', [email]);
      if (existing.rowCount) throw new Error('existing');
      const created = await client.query<{id:number}>(`insert into person(email,password_hash,full_name,kind,credits,active,created_at)
        values($1,$2,'New Atrium participant','participant',4000,true,now()) returning id`, [email, await import('../auth').then(({ hashPassword }) => hashPassword(crypto.randomBytes(32).toString('base64url')))]);
      const actor = { id: created.rows[0].id, email, full_name: 'New Atrium participant', kind: 'participant' as const, credits: 4000 };
      const sessions = await client.query<{ status:string; starts_at:Date; seat_fee_credits:number; capacity:number; discipline:string; coach_email:string }>(
        `select s.status,s.starts_at,s.seat_fee_credits,r.capacity,s.discipline,coach.email coach_email from session s join room r on r.id=s.room_id join person coach on coach.id=s.coach_id where s.id=$1 for update`, [id]
      );
      if (!sessions.rowCount || sessions.rows[0].status !== 'scheduled' || new Date(sessions.rows[0].starts_at) <= new Date()) throw new Error('unavailable');
      const session = sessions.rows[0];
      const capacity = await client.query<{ count:number }>("select count(*)::int count from enrolment where session_id=$1 and status='active'", [id]);
      if (capacity.rows[0].count >= session.capacity) throw new Error('full');
      if (session.seat_fee_credits > 4000) throw new Error('credits');
      const inserted = await client.query<{ id:number }>(`insert into enrolment(session_id,person_id,status,credits_charged,credits_refunded,enrolled_at)
        values($1,$2,'active',$3,0,now()) returning id`, [id,actor.id,session.seat_fee_credits]);
      await client.query('update person set credits=credits-$1 where id=$2', [session.seat_fee_credits, actor.id]);
      await queueEmail(client,{recipient:session.coach_email,subject:`New booking for ${session.discipline}`,bodyText:`A new participant booked a place in your ${session.discipline} session on ${formatCentreDateTime(session.starts_at)}.`,eventKey:`enrolment-created:${inserted.rows[0].id}:coach`});
      const booked = { booking_id: inserted.rows[0].id, session: session.discipline, credits_charged: session.seat_fee_credits };
      await client.query(`insert into account_setup_token(person_id,token_hash,expires_at) values($1,$2,now()+interval '24 hours')`, [actor.id,hashSetupToken(token)]);
      await queueEmail(client,{ recipient:email, subject:'Set your Atrium password', bodyText:`Set your password within 24 hours: ${(process.env.WEB_BASE_URL || 'http://localhost:3000')}/setup-password?token=${encodeURIComponent(token)}` });
      return booked;
    }, 'serializable');
    return { ok:true, data:{ ...data as object, password_setup_sent:true } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'existing') return { ok:false, error:'Please sign in to book with this email, or use the password recovery flow.' };
    if (reason === 'unavailable') return { ok:false, error:'That session is no longer available to book. Choose another upcoming session.' };
    if (reason === 'full') return { ok:false, error:'That session is full. Choose another upcoming session.' };
    return { ok:false, error:'This booking could not be completed. Please try another available session.' };
  }
}

export async function runAssistantTool(actor: Actor, name: string, input: { sessionId?: number; email?: string; startsAt?:string; endsAt?:string; roomId?:number; personQuery?:string; kind?:string; credits?:number; active?:boolean } = {}): Promise<ToolResult> {
  if (name === 'search_catalogue') return catalogue();
  if (name === 'public_session_details' && input.sessionId) return publicSession(input.sessionId);
  if (name === 'my_bookings') return myBookings(actor);
  if (name === 'my_credits') return myCredits(actor);
  if (name === 'admin_person_lookup' && input.email) return adminPersonLookup(actor, input.email);
  if (name === 'admin_all_sessions') return coachSessions(actor);
  if (name === 'admin_user_summary') return adminUserSummary(actor);
  if (name === 'admin_people') return adminPeople(actor, input.kind);
  if (name === 'admin_bookings') return adminBookings(actor, input.personQuery);
  if (name === 'admin_set_credits' && input.personQuery && input.credits !== undefined) return adminSetCredits(actor, input.personQuery, input.credits);
  if (name === 'admin_set_account_status' && input.personQuery && input.active !== undefined) return adminSetAccountStatus(actor, input.personQuery, input.active);
  if (name === 'my_coach_sessions') return coachSessions(actor, input.sessionId);
  if (name === 'owned_session_attendees' && input.sessionId) return attendees(actor, input.sessionId);
  if (name === 'owned_session_cancellations' && input.sessionId) return cancelledAttendees(actor, input.sessionId);
  if (name === 'book_my_place' && input.sessionId) return enrol(actor, input.sessionId);
  if (name === 'cancel_my_booking' && input.sessionId) return cancelEnrolment(actor, input.sessionId);
  if (name === 'cancel_owned_session' && input.sessionId) return cancelOwnedSession(actor, input.sessionId);
  if (name === 'reschedule_owned_session' && input.sessionId) return rescheduleOwnedSession(actor, input.sessionId, input.startsAt, input.roomId);
  if (name === 'guest_booking' && input.sessionId && input.email) return guestBooking(input.sessionId, input.email);
  if (name === 'booking_help') return { ok: true, data: {} };
  if (name === 'anonymous_booking_help') return { ok: true, data: {} };
  if (name === 'reschedule_help') return { ok: true, data: {} };
  if (name === 'coach_help') return { ok: true, data: {} };
  if (name === 'admin_help') return { ok: true, data: {} };
  if (name === 'privacy_explanation') return { ok: true, data: {} };
  if (name === 'request_private_other_person_data') return denied();
  return denied();
}

function selectTool(message: string, actor: Actor): { name: string; input?: {sessionId?:number;email?:string;startsAt?:string;roomId?:number;personQuery?:string;kind?:string;credits?:number;active?:boolean} } {
  const id = sessionIdFrom(message) ?? undefined; const email = emailFrom(message) ?? undefined; const lower = message.toLowerCase();
  const rescheduleMatch = message.match(/\b(?:reschedule|move)\s+(?:session\s*)?#?\s*(\d+).*?\bto\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}).*?\broom\s*#?\s*(\d+)\b/i);
  const asksPrivateData = /\b(show|list|what|who|give|tell)\b/.test(lower) && /\b(every|all|other|everyone|oscar|participants?|coaches?)\b/.test(lower);
  const coachSessionDetailRequest = Boolean(id) && /\b(attendees?|participants?|cancelled|cancellations?|repeat|repeated)\b/.test(lower);
  // A balance may be read through the self-service tool, but it can never be
  // changed through the assistant.  Keep this check before every role-specific
  // routing branch so wording such as "Make my credits 10000" cannot fall
  // through to `my_credits`.
  const asksUnauthorisedChange = /\b(change|increase|set|add|give|modify|make|update|adjust|boost|top\s*up)\b/.test(lower) && /\bcredits?|balance\b/.test(lower);
  if (actor?.kind === 'admin') {
    if (/\b(help|what can i do|admin commands|how does this work)\b/.test(lower)) return { name:'admin_help' };
    const creditChange = message.match(/\b(?:set|change|update)\s+(?:the\s+)?credits?\s+(?:for|of)\s+(.+?)\s+to\s+(\d+)\b/i) || message.match(/\b(?:set|change|update)\s+(.+?)(?:'s)?\s+credits?\s+to\s+(\d+)\b/i);
    if (creditChange) return { name:'admin_set_credits', input:{personQuery:creditChange[1].trim().replace(/'s$/i, ''),credits:Number(creditChange[2])} };
    const accountStatus = message.match(/\b(deactivate|disable|activate|enable)\s+(?:user\s+|account\s+)?(.+?)\s*$/i);
    if (accountStatus) return { name:'admin_set_account_status', input:{personQuery:accountStatus[2].trim(),active:/^(activate|enable)$/i.test(accountStatus[1])} };
    if (rescheduleMatch) {
      const startsAt = centreLocalDateTimeToIso(`${rescheduleMatch[2]} ${rescheduleMatch[3]}`);
      return startsAt ? { name:'reschedule_owned_session', input:{sessionId:Number(rescheduleMatch[1]),startsAt,roomId:Number(rescheduleMatch[4])} } : { name:'reschedule_owned_session', input:{sessionId:Number(rescheduleMatch[1])} };
    }
    if (id && lower.includes('cancel')) return { name:'cancel_owned_session', input:{sessionId:id} };
    const bookingPerson = message.match(/\b(?:show|list)\s+(?:the\s+)?bookings?\s+(?:for|of)\s+(.+?)\s*$/i);
    if (bookingPerson) return { name:'admin_bookings', input:{personQuery:bookingPerson[1].trim()} };
    if (/\b(show|list)\s+(?:all\s+)?bookings?\b/i.test(message)) return { name:'admin_bookings' };
    const peopleKind = lower.match(/\b(?:all\s+)?(participants|coaches|administrators|admins)\b/);
    if (/\b(show|list)\b/.test(lower) && (peopleKind || /\b(all\s+)?users\b/.test(lower))) {
      const kind = peopleKind?.[1].startsWith('participant') ? 'participant' : peopleKind?.[1].startsWith('coach') ? 'coach' : peopleKind ? 'admin' : undefined;
      return { name:'admin_people', input:{kind} };
    }
    if (lower.includes('all session') || lower.includes('every session')) return { name:'admin_all_sessions' };
    if (/\b(total|number|count|how many)\b/.test(lower) && /\b(user|users|people|participants|coaches)\b/.test(lower)) return { name:'admin_user_summary' };
    const namedCredit = lower.match(/(?:credit|balance).*?(?:for|of)\s+([a-z][a-z .'-]*)/i);
    if (namedCredit) return { name:'admin_person_lookup', input:{email:namedCredit[1].trim()} };
  }
  if (asksUnauthorisedChange || (asksPrivateData && !((actor?.kind === 'coach' || actor?.kind === 'admin') && coachSessionDetailRequest)) || (lower.includes('attendee') && actor?.kind === 'participant')) return { name:'request_private_other_person_data' };
  if (actor && (lower.includes('credit') || lower.includes('balance')) && !/\b(my|mine|i)\b/.test(lower)) return { name:'request_private_other_person_data' };
  if (!actor && (lower.includes('book') || lower.includes('reserve')) && id && email) return { name:'guest_booking', input:{sessionId:id,email} };
  if (!actor && (lower.includes('book') || lower.includes('reserve'))) return { name:'anonymous_booking_help' };
  if (id && /\b(cost|price|fee|how many|places|spots|when|time|details?)\b/.test(lower)) return { name:'public_session_details', input:{sessionId:id} };
  if (lower.includes('credit') || lower.includes('balance')) return { name:'my_credits' };
  if (actor?.kind === 'coach' && /\b(help|what can i do|coach commands|how does this work)\b/.test(lower)) return { name:'coach_help' };
  if ((lower.includes('my teaching') || lower.includes('sessions i teach') || lower.includes('my coach sessions') || /\b(show|list)\s+my\s+(?:sessions|schedule)\b/.test(lower)) && actor?.kind === 'coach') return { name:'my_coach_sessions' };
  if ((actor?.kind === 'coach' || actor?.kind === 'admin') && lower.includes('reschedule') && !rescheduleMatch) return { name:'reschedule_help' };
  if (actor?.kind === 'coach' && rescheduleMatch) {
    const startsAt = centreLocalDateTimeToIso(`${rescheduleMatch[2]} ${rescheduleMatch[3]}`);
    return startsAt ? { name:'reschedule_owned_session', input:{sessionId:Number(rescheduleMatch[1]),startsAt,roomId:Number(rescheduleMatch[4])} } : { name:'reschedule_owned_session', input:{sessionId:Number(rescheduleMatch[1])} };
  }
  if ((lower.includes('who cancelled') || lower.includes('who has cancelled')) && id) {
    return actor?.kind === 'coach' || actor?.kind === 'admin' ? { name:'owned_session_cancellations', input:{sessionId:id} } : { name:'request_private_other_person_data' };
  }
  if (lower.includes('cancel') && id) return actor?.kind === 'coach' ? {name:'cancel_owned_session',input:{sessionId:id}} : {name:'cancel_my_booking',input:{sessionId:id}};
  if (lower.includes('my booking') || lower.includes('my session')) return actor?.kind === 'coach' && (lower.includes('teach') || lower.includes('schedule')) ? { name:'my_coach_sessions' } : { name:'my_bookings' };
  if ((lower.includes('attendee') || lower.includes('participant') || lower.includes('cancelled') || lower.includes('repeat')) && id) return actor?.kind === 'coach' || actor?.kind === 'admin' ? { name:'owned_session_attendees', input:{sessionId:id} } : { name:'request_private_other_person_data' };
  if ((lower.includes('book') || lower.includes('reserve')) && id) return { name:'book_my_place', input:{sessionId:id} };
  if (actor && (lower.includes('book') || lower.includes('reserve'))) return { name:'booking_help' };
  return { name:'search_catalogue' };
}

function plainText(tool: string, result: ToolResult): string {
  if (!result.ok) return result.error;
  if (tool === 'search_catalogue') {
    const sessions = result.data as Array<{ id:number; discipline:string; session_type:string; starts_at:string; seat_fee_credits:number; room_name:string; places_remaining:number }>;
    if (sessions.length === 0) return 'There are no upcoming sessions available right now.';
    return `Here are upcoming sessions:\n${sessions.slice(0, 8).map(s => `• Session ${s.id}: ${s.discipline} (${s.session_type}) — ${formatCentreDateTime(s.starts_at)}, ${s.room_name}; ${s.seat_fee_credits} credits; ${s.places_remaining} places left.`).join('\n')}\n\nTo book, say: “Book session 123”.`;
  }
  if (tool === 'public_session_details') {
    const session = result.data as {id:number;discipline:string;session_type:string;starts_at:string;room_name:string;seat_fee_credits:number;places_remaining:number};
    return `Session ${session.id} is ${session.discipline} (${session.session_type}) at ${formatCentreDateTime(session.starts_at)} in ${session.room_name}. It costs ${session.seat_fee_credits} credits and has ${session.places_remaining} place(s) remaining.`;
  }
  if (tool === 'my_credits') return `Your remaining balance is ${(result.data as { credits:number }).credits} credits.`;
  if (tool === 'admin_person_lookup') {
    const people = result.data as Array<{full_name:string;email:string;kind:string;credits:number;active:boolean}>;
    return people.length ? people.map(p => `${p.full_name} (${p.kind}) has ${p.credits} credits and is ${p.active ? 'active' : 'inactive'}.`).join('\n') : 'No matching person was found.';
  }
  if (tool === 'admin_user_summary') {
    const rows = result.data as Array<{kind:string;count:number}>;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return `Atrium has ${total} user account(s): ${rows.map(row => `${row.count} ${row.kind}${row.count === 1 ? '' : 's'}`).join(', ')}.`;
  }
  if (tool === 'admin_people') {
    const people = result.data as Array<{full_name:string;email:string;kind:string;credits:number;active:boolean;booking_count:number;teaching_count:number}>;
    if (!people.length) return 'No matching users were found.';
    return `Users:\n${people.map(person => `• ${person.full_name} (${person.kind}) — ${person.email}; ${person.credits} credits; ${person.active ? 'active' : 'inactive'}; ${person.booking_count} active booking(s)${person.kind === 'coach' ? `; ${person.teaching_count} scheduled session(s)` : ''}.`).join('\n')}`;
  }
  if (tool === 'admin_bookings') {
    const bookings = result.data as Array<{session_id:number;full_name:string;email:string;status:string;credits_charged:number;credits_refunded:number;discipline:string;starts_at:string;room_name:string}>;
    if (!bookings.length) return 'No matching bookings were found.';
    return `Bookings:\n${bookings.map(booking => `• ${booking.full_name} (${booking.email}) — Session ${booking.session_id}, ${booking.discipline}, ${formatCentreDateTime(booking.starts_at)} in ${booking.room_name}; ${booking.status}; charged ${booking.credits_charged} credits${booking.credits_refunded ? `, refunded ${booking.credits_refunded}` : ''}.`).join('\n')}`;
  }
  if (tool === 'admin_set_credits') { const person = result.data as {full_name:string;kind:string;credits:number}; return `${person.full_name} (${person.kind}) now has ${person.credits} credits.`; }
  if (tool === 'admin_set_account_status') { const person = result.data as {full_name:string;kind:string;active:boolean}; return `${person.full_name} (${person.kind}) is now ${person.active ? 'active' : 'inactive'}.`; }
  if (tool === 'guest_booking') return 'Your place is booked. Check your email for a one-time link to create your Atrium password.';
  if (tool === 'booking_help') return 'First choose a session from the catalogue, then say: “Book session 123”. I will use your signed-in account and its available credits.';
  if (tool === 'anonymous_booking_help') return 'To book as a visitor, provide the session number and your email address. For example: “Book session 393 for name@example.com”. I will create your account and email a secure password-setup link.';
  if (tool === 'reschedule_help') return 'First ask for “Show my teaching sessions” to get an ID. Then reply exactly like this: “Reschedule session 802 to 2026-08-20 14:00 in room 2”. The date and time are America/New_York. I will check room availability and every affected attendee’s schedule before moving anyone.';
  if (tool === 'coach_help') return 'As a coach, start with: “Show my teaching sessions”. I will show your past and upcoming session IDs. Then you can say:\n• “Show attendees for session 802”\n• “Show participants for session 802”\n• “Who cancelled session 802?”\n• “Which attendees repeatedly attended my session 802?”\n• “Cancel session 802”\n• “Reschedule session 802 to 2026-08-20 14:00 in room 2”\n\nI can only show or change sessions you lead. You can also book or cancel a place in another coach’s session as an attendee.';
  if (tool === 'admin_help') return 'As an administrator, you can say:\n• “Show all users” or “Show all coaches”\n• “Show bookings for Sofia Marino” or “Show all bookings”\n• “Show all sessions”\n• “Show attendees for session 393”\n• “Show the credit balance for Oscar”\n• “Set Oscar’s credits to 2000”\n• “Deactivate Sofia Marino” or “Activate Sofia Marino”\n• “Cancel session 393”\n• “Reschedule session 393 to 2026-08-20 14:00 in room 2”';
  if (tool === 'book_my_place') { const booking = result.data as {session:string;credits_charged:number}; return `Your place in ${booking.session} is booked. ${booking.credits_charged} credits were charged.`; }
  if (tool === 'cancel_my_booking') { const cancelled = result.data as {credits_refunded:number}; return `Your booking was cancelled. ${cancelled.credits_refunded} credits were refunded.`; }
  if (tool === 'cancel_owned_session') { const cancelled = result.data as {id:number;participants_refunded:number;room_fee_refunded:number}; return `Session ${cancelled.id} was cancelled. ${cancelled.participants_refunded} participant booking(s) were cancelled and fully refunded. ${cancelled.room_fee_refunded} room credits were refunded.`; }
  if (tool === 'reschedule_owned_session') { const session = result.data as {id:number;starts_at:string;ends_at:string;participants_moved:number}; return `Session ${session.id} was rescheduled to ${formatCentreDateTime(session.starts_at)}. ${session.participants_moved} active participant booking(s) moved with it and were notified.`; }
  if (tool === 'my_bookings') {
    const bookings = result.data as Array<{session_id:number;status:string;discipline:string;starts_at:string;room_name:string;credits_charged:number;credits_refunded:number}>;
    if (bookings.length === 0) return 'You have no bookings.';
    return `Your bookings:\n${bookings.map(b => `• Session ${b.session_id}: ${b.discipline} — ${formatCentreDateTime(b.starts_at)}, ${b.room_name}; ${b.status}; charged ${b.credits_charged} credits${b.credits_refunded ? `, refunded ${b.credits_refunded}` : ''}.`).join('\n')}\n\nTo cancel an active place, say: “Cancel booking 123”.`;
  }
  if (tool === 'my_coach_sessions') {
    const sessions = result.data as Array<{id:number;discipline:string;status:string;starts_at:string;ends_at:string;room_name:string}>;
    if (sessions.length === 0) return 'You have no teaching sessions.';
    return `Your teaching sessions:\n${sessions.map(s => `• Session ${s.id}: ${s.discipline} — ${formatCentreDateTime(s.starts_at)}, ${s.room_name}; ${s.status}.`).join('\n')}\n\nUse one of these IDs to ask for attendees, cancellations, or to cancel a session.`;
  }
  if (tool === 'admin_all_sessions') {
    const sessions = result.data as Array<{id:number;discipline:string;status:string;starts_at:string;room_name:string}>;
    return sessions.length ? `All sessions:\n${sessions.slice(0, 30).map(s => `• Session ${s.id}: ${s.discipline} — ${formatCentreDateTime(s.starts_at)}, ${s.room_name}; ${s.status}.`).join('\n')}` : 'There are no sessions.';
  }
  if (tool === 'owned_session_attendees') {
    const people = result.data as Array<{full_name:string;status:string;cancelled_at:string | null;attended_with_you:number}>;
    if (people.length === 0) return 'There are no participant bookings for this session.';
    return `Participants for your session:\n${people.map(p => `• ${p.full_name}: ${p.status}${p.cancelled_at ? ' (cancelled)' : ''}; attended with you ${p.attended_with_you} time(s).`).join('\n')}`;
  }
  if (tool === 'owned_session_cancellations') {
    const people = result.data as Array<{full_name:string;cancelled_at:string;credits_refunded:number}>;
    if (people.length === 0) return 'No participant has cancelled their booking for this session.';
    return `Participants who cancelled:\n${people.map(p => `• ${p.full_name} — refunded ${p.credits_refunded} credits.`).join('\n')}`;
  }
  return JSON.stringify(result.data);
}

async function responseText(message: string, tool: string, result: ToolResult): Promise<string> {
  if (!result.ok) return result.error;
  if (process.env.MODEL_PROVIDER !== 'openai' || !process.env.MODEL_API_KEY) return plainText(tool, result);
  try {
    const response = await fetch(`${(process.env.MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MODEL_API_KEY}`}, body:JSON.stringify({model:process.env.MODEL_NAME,temperature:0.2,messages:[{role:'system',content:'Answer concisely using only the supplied authorised result. Do not infer missing data.'},{role:'user',content:`Question: ${message}\nAuthorised result: ${JSON.stringify(result.data)}`}]}), signal:AbortSignal.timeout(15000) });
    const body = await response.json() as { choices?: Array<{message?:{content?:string}}> };
    return body.choices?.[0]?.message?.content || plainText(tool, result);
  } catch { return plainText(tool, result); }
}

router.post('/chat', optionalSession, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
  if (!message) { res.status(400).json({ error:'message is required' }); return; }
  const actor = (res.locals.person as Actor | undefined) ?? null;
  const selected = selectTool(message, actor);
  const result = await runAssistantTool(actor, selected.name, selected.input);
  res.json({ message: await responseText(message, selected.name, result), tool: selected.name, data: result.ok ? result.data : undefined });
});

export default router;
