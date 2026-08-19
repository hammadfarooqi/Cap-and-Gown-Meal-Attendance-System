-- Facet the rush histogram by meal.
--
-- Rendering the first version showed the bug: lunch and dinner sat on one
-- continuous minute-of-day axis, so six hours of empty afternoon separated
-- two clusters of hairline-thin bars. The question is "when is the line
-- longest DURING A MEAL", which is a small-multiple, not one wide axis.

drop function if exists rush_histogram(date, date, int);

create or replace function rush_histogram(from_date date, to_date date, bucket_minutes int default 5)
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
  ) local_times
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function rush_histogram(date, date, int) from public, anon, authenticated;
grant execute on function rush_histogram(date, date, int) to service_role;
