-- Headshots live in a PRIVATE bucket.
--
-- These are photographs of students. A public bucket would put every one of
-- them behind a guessable URL, readable by anyone who worked out the pattern.
-- Reads go through /api/photos/[netid], which requires an enrolled device
-- token — the same posture as everything else here: the anon key gets nothing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('headshots', 'headshots', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
