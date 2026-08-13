create table email_outbox (
  id bigserial primary key,
  event_key text unique,
  recipient text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint email_outbox_status_valid check (status in ('pending', 'sending', 'sent')),
  constraint email_outbox_attempts_nonnegative check (attempts >= 0)
);

create index email_outbox_delivery_index
  on email_outbox (status, available_at, id)
  where status in ('pending', 'sending');

create table scheduled_job_run (
  job_name text not null,
  centre_date date not null,
  completed_at timestamptz not null default now(),
  primary key (job_name, centre_date)
);
