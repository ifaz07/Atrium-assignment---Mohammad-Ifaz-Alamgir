create extension if not exists btree_gist;

with cancelled_enrolments as (
  update enrolment
     set status = 'cancelled',
         credits_refunded = credits_charged,
         cancelled_at = coalesce(cancelled_at, now())
   where session_id in (69, 419, 463, 617)
     and status = 'active'
  returning person_id, credits_charged
), refunds as (
  select person_id, sum(credits_charged) as credits
    from cancelled_enrolments
   group by person_id
)
update person
   set credits = person.credits + refunds.credits
  from refunds
 where person.id = refunds.person_id;

with cancelled_sessions as (
  update session
     set status = 'cancelled'
   where id in (69, 419, 463, 617)
  returning coach_id, room_fee_credits
), refunds as (
  select coach_id, sum(room_fee_credits) as credits
    from cancelled_sessions
   group by coach_id
)
update person
   set credits = person.credits + refunds.credits
  from refunds
 where person.id = refunds.coach_id;

with cancelled_enrolments as (
  update enrolment
     set status = 'cancelled',
         credits_refunded = credits_charged,
         cancelled_at = coalesce(cancelled_at, now())
   where id in (292, 1600, 1928, 2369)
     and status = 'active'
  returning person_id, credits_charged
), refunds as (
  select person_id, sum(credits_charged) as credits
    from cancelled_enrolments
   group by person_id
)
update person
   set credits = person.credits + refunds.credits
  from refunds
 where person.id = refunds.person_id;

update session
   set ends_at = starts_at + interval '210 minutes'
 where session_type = 'intensive'
   and ends_at - starts_at = interval '180 minutes';

alter table person
  alter column email set not null,
  alter column password_hash set not null,
  alter column full_name set not null,
  alter column kind set not null,
  alter column credits type integer using floor(credits)::integer,
  alter column credits set not null,
  alter column active set not null,
  alter column created_at set not null;

alter table room
  alter column name set not null,
  alter column capacity set not null;

alter table session
  alter column room_id set not null,
  alter column coach_id set not null,
  alter column discipline set not null,
  alter column session_type set not null,
  alter column status set not null,
  alter column starts_at set not null,
  alter column ends_at set not null,
  alter column room_fee_credits type integer using floor(room_fee_credits)::integer,
  alter column room_fee_credits set not null,
  alter column seat_fee_credits type integer using floor(seat_fee_credits)::integer,
  alter column seat_fee_credits set not null;

alter table enrolment
  alter column session_id set not null,
  alter column person_id set not null,
  alter column status set not null,
  alter column credits_charged type integer using floor(credits_charged)::integer,
  alter column credits_charged set not null,
  alter column credits_refunded type integer using floor(credits_refunded)::integer,
  alter column credits_refunded set not null,
  alter column enrolled_at set not null;

alter table person
  add constraint person_email_unique unique (email),
  add constraint person_kind_valid check (kind in ('admin', 'coach', 'participant')),
  add constraint person_credits_nonnegative check (credits >= 0);

alter table room
  add constraint room_name_unique unique (name),
  add constraint room_capacity_positive check (capacity > 0);

alter table session
  add constraint session_type_valid check (session_type in ('short', 'standard', 'intensive')),
  add constraint session_status_valid check (status in ('scheduled', 'cancelled', 'completed')),
  add constraint session_times_valid check (ends_at > starts_at),
  add constraint session_duration_matches_type check (
    (session_type = 'short' and ends_at - starts_at = interval '45 minutes')
    or (session_type = 'standard' and ends_at - starts_at = interval '60 minutes')
    or (session_type = 'intensive' and ends_at - starts_at = interval '210 minutes')
  ),
  add constraint session_room_fee_nonnegative check (room_fee_credits >= 0),
  add constraint session_seat_fee_nonnegative check (seat_fee_credits >= 0),
  add constraint session_room_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled');

alter table enrolment
  add constraint enrolment_status_valid check (status in ('active', 'cancelled')),
  add constraint enrolment_charge_nonnegative check (credits_charged >= 0),
  add constraint enrolment_refund_valid check (credits_refunded >= 0 and credits_refunded <= credits_charged);

create unique index enrolment_active_person_session_unique
  on enrolment (session_id, person_id)
  where status = 'active';

create index session_active_calendar_index
  on session (starts_at)
  where status <> 'cancelled';

create index session_active_coach_time_index
  on session (coach_id, starts_at)
  where status <> 'cancelled';

create index enrolment_active_session_index
  on enrolment (session_id)
  where status = 'active';

create index enrolment_active_person_index
  on enrolment (person_id)
  where status = 'active';

create index check_in_enrolment_index
  on check_in (enrolment_id);
