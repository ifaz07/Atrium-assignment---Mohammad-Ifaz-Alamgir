create table account_setup_token (
  id bigserial primary key,
  person_id integer not null references person(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index account_setup_token_active_index
  on account_setup_token (token_hash)
  where used_at is null;
