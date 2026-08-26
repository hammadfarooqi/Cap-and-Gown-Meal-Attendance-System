-- Let the analytics answer "what does a Monday look like".
--
-- "Every Monday this semester" is a date range AND a day-of-week filter, so
-- it cannot be expressed as a range alone. `days` is an array of Postgres
-- day-of-week numbers (0 = Sunday); null means every day, so every existing
-- caller keeps working untouched.

drop function if exists daily_headcount(date, date);
drop function if exists rush_histogram(date, date, int);
drop function if exists guests_by_club(date, date);

create or replace function daily_headcount(from_date date, to_date date, days int[] default null)
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
    and (days is null or extract(dow from s.meal_date)::int = any(days))
  group by s.meal_date, s.meal_period
  order by s.meal_date, s.meal_period;
$$;

create or replace function rush_histogram(
  from_date date, to_date date, bucket_minutes int default 5, days int[] default null
)
returns table (meal_period text, minute_of_day int, total bigint)
language sql
stable
as $$
  select
    meal_period,
    (floor(
      (extract(hour from local_time) * 60 + extract(minute from local_time))::numeric
      / bucket_minutes
    ) * bucket_minutes)::int as minute_of_day,
    count(*)                 as total
  from (
    select s.meal_period, (s.scanned_at at time zone 'America/New_York') as local_time
    from swipes s
    where s.meal_date between from_date and to_date
      and (days is null or extract(dow from s.meal_date)::int = any(days))
  ) local_times
  group by 1, 2
  order by 1, 2;
$$;

create or replace function guests_by_club(from_date date, to_date date, days int[] default null)
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
    and (days is null or extract(dow from s.meal_date)::int = any(days))
  group by 1
  order by 2 desc, 1;
$$;

-- Which semesters actually hold data, so the selector offers real choices
-- rather than an invented list.
create or replace function semesters_with_data()
returns table (year int, term text, first_meal date, last_meal date, meals bigint)
language sql
stable
as $$
  select
    (case when extract(month from s.meal_date) >= 8
          then extract(year from s.meal_date) else extract(year from s.meal_date) end)::int as year,
    (case when extract(month from s.meal_date) >= 8 then 'fall' else 'spring' end) as term,
    min(s.meal_date) as first_meal,
    max(s.meal_date) as last_meal,
    count(*)         as meals
  from swipes s
  group by 1, 2
  order by 1 desc, 2;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'daily_headcount(date, date, int[])',
    'rush_histogram(date, date, int, int[])',
    'guests_by_club(date, date, int[])',
    'semesters_with_data()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
