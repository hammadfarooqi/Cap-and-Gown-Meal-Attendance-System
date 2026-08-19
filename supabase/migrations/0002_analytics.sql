-- Analytics live in the database, not in JavaScript.
--
-- Fetching a semester of swipes and grouping them in the app would be slower
-- and easier to get wrong, and every one of these needs the club's timezone
-- applied consistently. Postgres does that in one place.
--
-- Daily grouping uses swipes.meal_date, which the sync endpoint already
-- derived as a New York calendar date. Anything reading the clock — the
-- rush histogram, "today" — converts explicitly.

create or replace function daily_headcount(from_date date, to_date date)
returns table (meal_date date, meal_period text, total bigint, members bigint, guests bigint)
language sql
stable
as $$
  select
    s.meal_date,
    s.meal_period,
    count(*)                                    as total,
    count(*) filter (where s.was_member)        as members,
    count(*) filter (where not s.was_member)    as guests
  from swipes s
  where s.meal_date between from_date and to_date
  group by s.meal_date, s.meal_period
  order by s.meal_date, s.meal_period;
$$;

-- When is the line longest. The chart this project earns its keep with.
--
-- Buckets scanned_at, NOT received_at: a tablet that syncs an hour late must
-- not move the peak. Minute-of-day is in New York, or the axis is wrong by
-- three to four hours depending on the season.
create or replace function rush_histogram(from_date date, to_date date, bucket_minutes int default 5)
returns table (minute_of_day int, total bigint)
language sql
stable
as $$
  select
    (floor(
      (extract(hour from local_time) * 60 + extract(minute from local_time))::numeric
      / bucket_minutes
    ) * bucket_minutes)::int as minute_of_day,
    count(*)                 as total
  from (
    select (s.scanned_at at time zone 'America/New_York') as local_time
    from swipes s
    where s.meal_date between from_date and to_date
  ) local_times
  group by 1
  order by 1;
$$;

-- Today means the club's today. At 21:00 Pacific it is already tomorrow in
-- New York, and a developer checking from another timezone must still see
-- what the business manager sees.
create or replace function today_count()
returns table (meal_period text, total bigint, members bigint, guests bigint)
language sql
stable
as $$
  select
    s.meal_period,
    count(*)                                 as total,
    count(*) filter (where s.was_member)     as members,
    count(*) filter (where not s.was_member) as guests
  from swipes s
  where s.meal_date = (now() at time zone 'America/New_York')::date
  group by s.meal_period
  order by s.meal_period;
$$;

-- Visits and distinct people are different questions. "Cottage came 40 times"
-- and "40 different people from Cottage came" mean very different things for
-- end-of-semester reconciliation.
create or replace function guests_by_club(from_date date, to_date date)
returns table (home_club text, visits bigint, people bigint)
language sql
stable
as $$
  select
    coalesce(p.home_club, 'None') as home_club,
    count(*)                      as visits,
    count(distinct s.netid)       as people
  from swipes s
  join people p on p.netid = s.netid
  where s.meal_date between from_date and to_date
    and not s.was_member
  group by 1
  order by 2 desc, 1;
$$;

-- One row per swipe, for the CSV export.
create or replace function swipe_rows(from_date date, to_date date)
returns table (
  netid text,
  full_name text,
  was_member boolean,
  home_club text,
  meal_date date,
  meal_period text,
  scanned_at_local timestamp
)
language sql
stable
as $$
  select
    s.netid,
    p.full_name,
    s.was_member,
    p.home_club,
    s.meal_date,
    s.meal_period,
    (s.scanned_at at time zone 'America/New_York')
  from swipes s
  join people p on p.netid = s.netid
  where s.meal_date between from_date and to_date
  order by s.meal_date, s.meal_period, s.scanned_at;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'daily_headcount(date, date)',
    'rush_histogram(date, date, int)',
    'today_count()',
    'guests_by_club(date, date)',
    'swipe_rows(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
