-- Cap & Gown Meal Attendance System — initial schema.
-- See docs/specs/2026-08-16-meal-attendance-system-design.md section 6.

-- The eleven eating clubs, plus 'None' for a guest who is not in a club.
-- A table rather than a check constraint, so adding co-ops later is an INSERT.
create table clubs (
  name text primary key
);

-- netID is the canonical identity for everyone, member or guest.
-- People are never archived and never deleted; they stop being members.
create table people (
  netid       text primary key,
  full_name   text not null,
  is_member   boolean not null default false,
  class_year  int,
  home_club   text references clubs(name),
  photo_path  text
);

-- Card tokens map to a person, MANY tokens to one netID. A replacement card
-- adds a row; nothing is ever overwritten, so a bad binding stays recoverable.
create table credentials (
  token      text primary key,
  netid      text not null references people(netid),
  created_at timestamptz not null default now()
);

-- Enrolled tablets. token_hash only: the plaintext token lives on the tablet,
-- so a database dump cannot be used to impersonate a station.
create table devices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  token_hash   text not null unique,
  enrolled_at  timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

create table enrollment_codes (
  code       text primary key,
  name       text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  device_id  uuid references devices(id)
);

-- The primary key does two jobs: it enforces "counted once per meal", and it
-- makes the sync queue idempotent for free. A re-sent batch bounces off it,
-- so the tablet needs no acknowledgement protocol.
create table swipes (
  netid        text not null references people(netid),
  meal_date    date not null,
  meal_period  text not null,
  was_member   boolean not null,
  scanned_at   timestamptz not null,
  received_at  timestamptz not null default now(),
  station_id   uuid references devices(id),
  entry_method text not null,
  primary key (netid, meal_date, meal_period)
);

-- Powers the rush-hour histogram, which reads scanned_at across a meal.
create index swipes_meal_idx on swipes (meal_date, meal_period);

create table meal_schedule (
  day_of_week   int  not null,  -- 0 = Sunday
  period_name   text not null,
  start_time    time not null,
  end_time      time not null,
  grace_minutes int  not null default 15,
  primary key (day_of_week, period_name)
);

create table admins (
  user_id  uuid primary key,
  email    text not null,
  added_at timestamptz not null default now(),
  added_by uuid references admins(user_id)
);

-- Drives the version envelope on every API response, so a tablet learns
-- about roster and schedule changes off traffic it was already sending.
create table versions (
  resource text primary key,
  version  int  not null default 1
);

-- Access posture: every read and write goes through our API using the
-- service-role key. The anon key gets nothing at all.
--
-- Row-level security is enabled on every table with no policies attached,
-- which denies anon and authenticated outright. service_role bypasses RLS by
-- design, so the API keeps working. This means a leaked anon key — which ships
-- to the browser by definition — cannot read the roster or write a swipe.
do $$
declare t text;
begin
  foreach t in array array[
    'clubs','people','credentials','devices','enrollment_codes',
    'swipes','meal_schedule','admins','versions'
  ] loop
    execute format('grant all on table public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
