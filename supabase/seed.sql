-- The eleven Princeton eating clubs, plus 'None'.
-- 'None' records the absence of an eating club. It claims nothing else about
-- the person: they may be a first-year, in a co-op, or simply not in a club.
insert into clubs (name) values
  ('Cap & Gown'), ('Cannon'), ('Charter'), ('Cloister'), ('Colonial'),
  ('Cottage'), ('Ivy'), ('Quadrangle'), ('Terrace'), ('Tiger Inn'),
  ('Tower'), ('None')
on conflict (name) do nothing;

insert into versions (resource, version) values
  ('roster', 1), ('schedule', 1)
on conflict (resource) do nothing;


-- Meal windows. day_of_week follows Postgres and JS: 0 = Sunday.
-- Provisional as of 2026-08-16, pending confirmation with the business
-- manager (open question O3). The admin dashboard will edit these, so the
-- insert is conflict-safe and will not clobber a later correction.
--
-- Weekdays: breakfast, lunch, dinner. Weekends: brunch, dinner.
insert into meal_schedule (day_of_week, period_name, start_time, end_time, grace_minutes)
select d, 'breakfast', '08:00'::time, '09:30'::time, 15 from generate_series(1, 5) d
union all
select d, 'lunch',     '11:30'::time, '13:30'::time, 15 from generate_series(1, 5) d
union all
select d, 'dinner',    '18:00'::time, '19:30'::time, 15 from generate_series(1, 5) d
union all
select d, 'brunch',    '11:30'::time, '13:30'::time, 15 from unnest(array[0, 6]) d
union all
select d, 'dinner',    '18:00'::time, '19:30'::time, 15 from unnest(array[0, 6]) d
on conflict (day_of_week, period_name) do nothing;
