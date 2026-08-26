-- The keep-alive must WRITE, not read.
--
-- Found the hard way on 2026-08-25: the project paused despite a scheduled
-- ping that ran on time and returned ok every run. The ping was a SELECT.
-- Supabase's inactivity timer counts real database activity, and the
-- documented remedy is "an insert to a ping table" — a read served through
-- PostgREST's pooled connections evidently does not reset it.
--
-- The timeline fits exactly: the last WRITE to this database was the roster
-- load on 2026-08-19, and the project paused almost exactly seven days later,
-- having been read three times in between.
--
-- A dedicated table rather than touching `versions`: bumping a version stamp
-- would tell every tablet its roster had changed and trigger a needless
-- re-bootstrap twice a week.
create table heartbeat (
  id        int primary key default 1,
  last_ping timestamptz not null default now(),
  constraint heartbeat_is_a_singleton check (id = 1)
);

insert into heartbeat (id) values (1);

grant all on table public.heartbeat to service_role;
alter table public.heartbeat enable row level security;
revoke all on table public.heartbeat from anon, authenticated;
