-- One person, one card.
--
-- This reverses the original many-tokens-to-one-netID design on
-- `credentials`. That design bound both stripe numbers so that whichever
-- survived a card reissue would keep working. The station now binds a single
-- 15-digit base number, and a member who turns up with a card the base does
-- not cover is a case for an officer rather than another row.
--
-- Enforced here rather than only in the route because two tablets can both
-- believe a person is unbound - each decides from its own cached copy of the
-- roster, refreshed only at bootstrap. Only one insert can win against this
-- index, so the loser fails loudly at sync instead of quietly adding a second
-- card and splitting one person's attendance across two credentials.
--
-- Safe to apply: `credentials` held 0 rows locally and 0 in production when
-- this was written, both verified before the migration was committed.
create unique index credentials_one_per_person on credentials (netid);

comment on table credentials is
  'Card tokens, ONE per person. The token is track 1''s 15-digit base number; '
  'the four-digit track 2 suffix is assumed to be a card issue number and is '
  'not stored. See docs/specs/2026-08-26-card-identity-and-first-swipe.md.';
