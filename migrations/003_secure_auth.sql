create table app_session (
  id serial primary key,
  person_id integer not null references person(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index app_session_person_index on app_session (person_id);
create index app_session_expiry_index on app_session (expires_at);

update person
   set password_hash = case id
     when 1 then '$2b$12$Q9x3Oro1jntxHIWcL/ID2ekZkEIwossxJ41cIErLYxtVc194Z/c4S'
     when 2 then '$2b$12$k74uAowJfHC1bMDroooimupntItw9zYHd9pFt9PcCgKLhhBj3Orkm'
     when 3 then '$2b$12$sQYaPsmNQnZvokrObmeknukZjXeR.Zuo3UeNvRXukAPlgD4Vyde1i'
   end
 where id in (1, 2, 3);
