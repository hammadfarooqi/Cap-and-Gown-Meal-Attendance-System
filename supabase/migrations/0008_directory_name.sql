-- The name the University knows somebody by, kept beside the one the club
-- uses.
--
-- The roster is the club's data and holds the names people actually go by;
-- that is what belongs on a check-in screen. But a TigerCard is printed from
-- the University's record, so the two disagree for anyone whose roster entry
-- is a preferred name.
--
-- Measured before this existed: of 196 members, 5 would NOT have matched
-- their own card. Four were a nickname against a legal first name, one shared
-- no word at all. Those five would each have met the guest form on their
-- first swipe at go-live.
--
-- Rewriting the roster to suit the matcher was the alternative, and it is the
-- wrong way round: it would put legal names on the screen for all 196 to fix
-- the match for 5. So both names are stored, `full_name` is displayed, and
-- the card is matched against either.
--
-- Nullable on purpose. A person the directory does not know simply matches on
-- `full_name`, exactly as before.
alter table people add column directory_name text;

comment on column people.directory_name is
  'Display name from Princeton LDAP, used ONLY for matching a card''s printed '
  'name. Never displayed - full_name is what the club calls them.';
