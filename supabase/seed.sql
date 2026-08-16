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

-- The meal schedule is deliberately not seeded. Real windows are open
-- question O3 and arrive from the business manager. Tests supply their own.
