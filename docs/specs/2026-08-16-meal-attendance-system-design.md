# System Design: Cap & Gown Meal Attendance System

**Last updated:** 2026-08-16
**Status:** Approved design. Ready for implementation planning.
**Go-live:** 2026-09-02 (first day of classes, first meals)
**On-site test:** 2026-08-30

---

## 1. Objective

Build a meal attendance system for the Cap & Gown Club. A student scans their
Princeton ID at a tablet. The system shows their photo and name, and records
that they ate. An admin dashboard turns those records into counts the club can
act on.

The club has roughly **200 members in the autumn and roughly 300 in the spring**,
because the incoming class joins mid-year. Meals are served across three tablet
stations.

That mid-year jump is a design fact, not a footnote. The roster grows by about a
hundred people in February, along with a hundred new headshots and a hundred new
card bindings. Roster management and photo upload therefore have a **second hard
deadline in February**, not just the October one.

### Core tenets

1. **The line never stops.** A scan must resolve in under 500 ms. A network
   failure must never block a student at the door.
2. **Zero maintenance.** The system self-heals and costs $0 a month to run.
3. **Data integrity.** Duplicate scans and manual entries are handled centrally,
   so the counts are correct.
4. **The club owns it.** The system must keep working after the original
   developer graduates. No dependency requires a developer to maintain.

---

## 2. Scope

### In scope

- Recording who ate, at which meal, on which day.
- Distinguishing members from guests, and recording a guest's home club.
- An admin dashboard for counts, exports, and roster management.

### Out of scope

- **Meal swaps and meal exchange.** A separate portal handles these. This
  system only needs to count who ate and mark member or non-member.
- **Payments.** No money moves through this system. It is a check-in system,
  not a point of sale, despite the name used in the original documents.
- **Access control.** The system records attendance. It does not admit or
  refuse anyone. A failed scan never denies a student food.

---

## 3. Assumptions

These are decisions taken deliberately. Each one can be revisited, but the
design leans on them.

**A1 — Credential capture. CLOSED 2026-08-26.** A magnetic-stripe reader,
acting as a keyboard wedge. A real TigerCard produces this shape (the number
and name below are synthetic; the structure and the timings are measured):

```
%999999000000123=ALICE/BROWNING?;9999990000001238700=?

Nine swipes, 2026-08-26:
  54 characters every time · exactly 1 Enter every time
  total time  337-342 ms  (1.5% spread)
  largest gap    9-16 ms  (78% spread)
```

Three things this settled:

- **Neither number is the netID.** They are card numbers, so `credentials`
  stays a separate many-to-one table. Collapsing it into `people` as the
  "simpler" option would have meant a schema migration on the day.
- **Track 2 is track 1 plus four digits** (`8700`), which has the shape of a
  card issue suffix that changes on reissue. Untested, so nothing guesses:
  both numbers are bound, and whichever survives keeps working.
- **The stripe carries the holder's name**, which pre-fills the member picker
  during first-day enrolment.

One module converts a raw keystroke burst into a canonical token. Everything
downstream sees only that token. When the hardware is chosen, one module and one
parsing rule change, and nothing else moves.

**A2 — Scan capture is a global burst detector.** A `keydown` listener on the
document buffers keystrokes and fires a scan event, regardless of which element
has focus. The app never fights for focus on a text input. A scan is atomic: a
stray character on screen or a lost focus cannot corrupt it.

A scan fires on Enter only when **both** of these hold, with the values set
from the measurement in A1:

```js
const isScan =
  buffer.length >= 10 &&                                  // a real burst is 54
  (now - burstStartedAt) <= buffer.length * 25;           // 6.33 ms/char worst
// plus: the buffer clears on any inter-key gap > 80 ms   // 16 ms worst
```

**The two checks are tuned differently because they do different jobs.**

The pace check rejects a human: nobody sustains 25 ms per keystroke over ten
characters, and the fastest typists sit near 100 ms. It is also the stable
measurement — 1.5% spread across nine swipes — so it can sit close.

The gap check throws away a stray keypress and survives a hiccup mid-swipe. It
is the variable measurement — 78% spread — and it is **destructive**: one gap
over the threshold splits a burst and the swipe silently does nothing. So it
sits at five times the worst observed rather than tight against it. Widening it
does not admit a typist, because the pace check catches that independently.

**The ceiling is per character, not per burst.** The first version capped the
whole burst at 200 ms, chosen when the card was assumed to be a short barcode.
A TigerCard takes 339 ms, so every real swipe would have been silently ignored
— the door doing nothing all evening, with no error anywhere. Scaling by
length removes the assumption about how much the reader sends.

It is also a tighter constraint on the *average* pace than the gap alone: a
burst where every gap sits just under 50 ms would pass the gap test but fail
this one, which is what sustained fast typing looks like.

Testing the burst — not merely testing for a non-empty buffer — is what stops a
human typing `ab1234` by hand from firing a spurious scan of the last character
they happened to type within the gap window. When the test fails, the handler
does nothing and lets the event flow through, so the manual entry box submits
normally.

`/station/reader-check` measures all of this against real hardware, and should
be run again on the club's own tablets — a different USB stack may be slower
than a laptop.

**A3 — netID is the canonical identity.** Every person, member or guest, is one
record keyed by netID. Card tokens are separate records that point at a netID,
**many tokens to one netID**.

**A4 — Repeat scans are idempotent.** Any scan after the first in the same meal
shows the identical success screen. The student sees no difference. The database
counts them once.

**A5 — Two-tier scan resolution.** A token in the tablet's local cache resolves
with no network at all. Only the first sight of a token on a given tablet
requires a server call.

**A6 — Failures are abandoned, not queued.** If an operation needs the server
and the server does not answer within the timeout and retries, the tablet
abandons that scan and shows a clear failure message. Nothing is stored and
nothing is reconciled. The count is lost, and that is accepted.

Because a failure is abandoned rather than recovered, the whole attempt must be
short. **Budget: 3 seconds total** — roughly a 1-second timeout with two
retries. A student standing at a tablet for thirty seconds waiting for a failure
is worse than the lost count.

**A7 — Meal swaps are out of scope.** Confirmed with the business manager.

---

## 4. Open questions

| ID | Question | Closes by | Blocks |
|---|---|---|---|
| ~~O1~~ | ~~What token does the reader emit?~~ | **Closed 2026-08-26** — magstripe sends both tracks in one 54-character burst; neither number is the netID | `credentials` STAYS: many tokens to one person |
| O2 | Which directory API resolves a netID to a name — TigerBook or Princeton LDAP? Does it work from a serverless function? | Before guest flow is built | Guest entry |
| O3 | Exact meal windows for every day of the week | Next business-manager call | Seed data only |
| ~~O4~~ | ~~Actual member count~~ | **Closed 2026-08-16** — ~200 autumn, ~300 spring | — |
| O5 | **Headshots.** The roster (names and netIDs) is in hand. The photos are not | Before 2026-08-30 — **highest slip risk** | The headshot feature only |
| ~~O6~~ | ~~How are the headshot files named?~~ | **No longer blocking 2026-08-26** — matched names import, the rest are assigned by hand in the dashboard | — |

None of these block the build. O5 is the item most likely to slip, because it
depends on a club officer in August.

**O5 does not block go-live.** If the headshots do not arrive in time, the
station shows the student's name against a placeholder. Every count is still
correct. The photo is the premium touch, not the function.

**O6 is about naming, not size.** Resolution and file size do not matter, since
the import pipeline re-encodes everything to a 400×400 WebP regardless of what
arrives. What matters is whether each file can be matched to a netID. Files
named `ab1234.jpg` import themselves. Files named `Alice Browning.jpg` need a
name-to-netID match, which will fail on duplicates, nicknames, and middle names.
Files named `IMG_4471.jpg` cannot be matched at all and would need 300 manual
assignments. Ask the business manager how the files are named **before** the
photos are handed over, while it is still cheap for them to rename the export.

---

## 5. System architecture

Four components. Each has one job.

```
┌─────────────────────┐
│   STATION APP       │  3 tablets, identical, PWA
│   - burst detector  │
│   - local cache     │───┐
│   - outbox          │   │
└─────────────────────┘   │
                          │  HTTPS
┌─────────────────────┐   │
│   ADMIN DASHBOARD   │───┤
└─────────────────────┘   │
                          ▼
                 ┌───────────────────┐
                 │   API (Vercel)    │  stateless
                 └────────┬──────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     ┌─────────────────┐    ┌──────────────────┐
     │ Postgres        │    │ Object storage   │
     │ (Supabase)      │    │ headshots        │
     └─────────────────┘    └──────────────────┘
```

**Station app.** Runs on all three tablets. There is no special "manual entry"
station and no special "guest" station. Any tablet can do anything. This is the
only component that must work offline, so it is the only one that holds state.

**API.** Stateless request handlers. Four jobs: hand a tablet its cache at
startup, answer "who is this token", accept a batch of queued items, and serve
the dashboard.

**Database.** The single source of truth. Deduplication is enforced by a
constraint, not by application logic.

**Object storage.** Headshots. Written by the dashboard, read once per tablet at
startup, then cached in IndexedDB.

### The schedule boundary

The tablet holds the meal schedule and uses it to tell the student **which meal
they checked into**, or that no meal is running. The server holds the same
schedule and derives the meal independently when the scan arrives.

Same input, same rule, so they agree. **If they ever disagree, the server's
answer is the one that counts.** The tablet's copy drives the message on the
screen. The server's copy drives the number in the database.

This matters because a schedule change is then one row on the server, not a
push to three tablets during a rush.

---

## 6. Data model

```sql
people
  netid        text    primary key      -- canonical identity
  full_name    text                     -- from directory lookup
  is_member    boolean not null         -- current status
  class_year   int     null
  home_club    text    references clubs(name)   -- members: 'Cap & Gown'
  photo_path   text    null

credentials
  token        text    primary key      -- whatever the reader emits
  netid        text    not null references people
  created_at   timestamptz

swipes
  netid        text    not null references people
  meal_date    date    not null
  meal_period  text    not null         -- 'breakfast'|'lunch'|'dinner'|'brunch'
  was_member   boolean not null         -- snapshot, never changes
  scanned_at   timestamptz not null     -- tablet clock
  received_at  timestamptz default now()
  station_id   uuid    references devices(id)
  entry_method text                     -- 'scan' | 'manual'
  primary key (netid, meal_date, meal_period)

meal_schedule
  day_of_week   int                      -- 0 = Sunday
  period_name   text                     -- matches swipes.meal_period
  start_time    time
  end_time      time
  grace_minutes int default 15

clubs
  name         text primary key         -- 11 eating clubs + 'None'

devices                                 -- enrolled tablets
  id            uuid primary key
  name          text not null           -- 'Lane 1', 'Lane 2'
  token_hash    text not null unique    -- hash of the device token, never the token
  enrolled_at   timestamptz not null
  last_seen_at  timestamptz
  revoked_at    timestamptz             -- null while active

enrollment_codes                        -- one-time codes for enrolling a tablet
  code          text primary key
  expires_at    timestamptz not null
  used_at       timestamptz
  device_id     uuid references devices

admins                                  -- dashboard allowlist
  user_id       uuid primary key        -- references auth.users
  email         text not null
  added_at      timestamptz not null
  added_by      uuid references admins

versions                                -- drives the response envelope
  resource      text primary key        -- 'roster' | 'schedule'
  version       int not null default 1
```

`swipes.station_id` references `devices.id`, so a swipe records which tablet
took it.

**Device tokens are stored hashed.** The plaintext token exists only on the
tablet. A database dump therefore does not let anyone impersonate a station.

Three meals on weekdays, two at weekends. A scan counts toward a meal if it
falls inside `start_time - grace_minutes` to `end_time + grace_minutes`. Windows
are assumed not to overlap once grace is applied; the seed data must be checked
for this when O3 closes.

### Why it is shaped this way

**One `people` table, not separate members and guests.** netID is the identity,
and the identity does not change when the relationship does. A student who ate
here as a guest in September and joins the club in January is the same row with
`is_member` flipped. Her guest history stays attached to her.

**`swipes.was_member` is a snapshot.** Membership is a *current* fact. Swipes
are *historical* facts. Without this column, flipping someone to member in
January would retroactively recount them as a member in every autumn report,
silently changing numbers months after the fact.

**`credentials` is many-to-one, and it is insurance against O1.** If the reader
emits the PUID, the mapping is one-to-one and this table is unnecessary. If it
emits the 14-digit library barcode number, that number belongs to the *card*,
not the student, and a replacement card breaks one-to-one. We will not know
until the hardware test. Keeping the table costs one join on a rare path;
guessing wrong the other way costs a schema migration in October. If the
hardware test proves the token is stable, collapsing this into `people` is a
ten-minute change.

**The primary key does two jobs.** It enforces "counted once per meal". It also
makes the sync queue idempotent for free — a re-sent batch bounces off the
constraint, and the API treats that specific rejection as success. There is no
acknowledgement protocol, no sequence numbers, and no exactly-once machinery
anywhere in the system.

**Meal columns are `not null`, and out-of-meal scans are discarded.** A scan
outside every meal window is not data, because nobody ate. The safeguard against
a misconfigured schedule is not stored rows — it is the tablet showing "no meal
is running right now" to the very first person who scans. A wrong schedule is
visible in three seconds, not in a report six weeks later.

**`clubs` is a table, not a check constraint**, so adding co-ops later is an
INSERT rather than a migration. The value for a guest with no eating club is
`'None'` — it records the absence of a club, and claims nothing about the
person.

---

## 7. Scan flow

### What the tablet holds

All six stores are persisted, so a reboot loses nothing.

| Store | Contents | Size |
|---|---|---|
| `credentials` | token → netID | tiny |
| `roster` | netID → name, is_member, home_club | tiny |
| `photos` | headshots in IndexedDB | ~12 MB at spring peak |
| `schedule` | meal windows | ~5 rows |
| `outbox` | items not yet acknowledged | usually empty |
| `versions` | `{roster: 41, schedule: 3}` | 2 numbers |

### Startup

One request: `GET /api/bootstrap`. It returns the roster, the credential map,
the schedule, the version stamps, and a photo manifest. The tablet compares the
manifest against IndexedDB and downloads only what is missing.

First launch pulls about 12 MB with a full spring roster of 300. Every launch
after that pulls a few kilobytes.

### A scan

```
        token
          │
          ▼
   ┌──────────────────┐
   │ meal running?    │──no──▶ "No meal is running right now."
   └────────┬─────────┘         Nothing queued. Stop.
          yes
            ▼
   ┌──────────────────┐
   │ token in cache?  │──YES──▶ success + queue swipe
   └────────┬─────────┘          NO NETWORK.  ~50ms
           no
            ▼
   ┌──────────────────────┐
   │ POST /api/resolve    │
   └──┬────────┬───────┬──┘
      │        │       │
   known   unknown   no answer
      │        │       │
      ▼        ▼       ▼
   success  prompt   prompt (offline)
   + cache            │
              ┌───────┴────────┐
              ▼                ▼
          "Member"         "Guest"
       pick from cached   netID + club
       roster → bind      → needs server
       LOCALLY            → retry → abandon
       counted            NOT counted
```

### The four cases

| # | Situation | Result | Network |
|---|---|---|---|
| 1 | Token in cache | Success, queued | None |
| 2 | Not cached, server knows | Success, cached for next time | One round trip |
| 3 | Not cached, server does not know | Prompt, then bind or create guest | Human-paced |
| 4 | Not cached, server unreachable | **Member:** resolves offline, counted. **Guest:** abandoned, not counted | Retries, then gives up |

Case 4 is the only lossy path in the system. It requires an unknown token *and*
an unreachable server *and* the person being a guest. This was accepted
deliberately in preference to building a review queue.

### The screen

| State | Shows |
|---|---|
| Success | Large headshot, name, "Checked in for Lunch". Clears on a ~3s timer |
| No meal | "No meal is running right now" |
| Looking up | Brief spinner. Only reachable on an unknown token |
| Prompt | Member picker or guest entry |
| Failed | "Could not reach the server — not counted", so the operator waves them through |

The success screen clears on a timer rather than persisting until the next
scan, so the next person in line does not see the previous student's face and
name.

### The member picker

The prompt lists members with **no bound credential first**, since that list
shrinks toward empty as the term proceeds. A **search across all members** stays
available, so a member who already has a binding and arrives with a new card can
be found and have the new token attached.

### Timing budget

On the cache-hit path: the burst detector fires on Enter with no waiting, the
map lookup is constant time, the photo reads from IndexedDB in about 10 ms, then
it renders. **Comfortably under 100 ms, with no network in the path.**

---

## 8. Sync and versioning

### The outbox

A background loop flushes the outbox every few seconds and immediately after
each scan. It carries three kinds of item: swipes, bindings, and new guests.

Two properties keep this simple:

**No ordering constraints.** A queued swipe carries a **netID**, not a token,
and the meal is derived server-side from `scanned_at`. So a swipe never depends
on its binding arriving first. Members already exist in `people`. Guests were
created during the blocking call. Items can be sent in any order and any
grouping.

**Re-sending is free.** The primary key rejects duplicates and the API treats
that rejection as success. A tablet that drops mid-batch just sends the whole
batch again.

### Version stamps

Every API response carries an envelope:

```json
{ "data": { ... },
  "versions": { "schedule": 3, "roster": 41 } }
```

The tablet compares those numbers to what it holds and fetches in the background
only what changed. Because the tablet already talks to the server constantly to
flush its outbox, **a roster or schedule change reaches all three tablets within
one sync cycle, with no polling and no push infrastructure.**

### Residual risk, accepted

In case 4, a tablet binds a token offline. If the server already had that token
bound to someone else, they conflict at sync. **The server keeps its existing
binding and records the conflict.** No further machinery is built, because the
conflict can only occur if the operator picked the wrong name from a list that
had the right one on it. That is human error, and no protocol prevents it.

---

## 9. Authentication

Both the dashboard and the scanner app are behind authentication. The scanner
must be protected so that nobody can find the URL, open it on a personal phone,
and check themselves in for a meal they did not eat.

### Dashboard: admin-managed accounts

Each officer gets an email-and-password account through Supabase Auth. A
user-management page lets any admin create an account, reset a password, or
remove someone.

**No email is ever sent.** Login is email plus password. Password resets are
performed by another admin inside the dashboard. This was the deciding factor:
Supabase's built-in mailer sends only 2 messages per hour and refuses to deliver
to any address not on the project team, so magic links would require a
third-party SMTP account — one more external service that has to outlive the
original developer.

Per-person accounts also give an audit trail, which matters because roster
dropping a roster's membership in bulk is destructive.

### Scanner: device enrollment

The station app is client-side code, so its source is public regardless. **The
protection is on the API.** Without a valid device token, `/api/bootstrap`
returns nothing and `/api/sync` refuses everything. A stranger who finds the URL
sees an enrollment screen and a dead end.

1. An admin adds a device in the dashboard and receives a **one-time enrollment
   code** that expires in minutes.
2. On the tablet, the code is entered once, ever.
3. The server issues a **long-lived device token**, stored in IndexedDB.
4. Every station API call carries it.
5. The dashboard lists devices with last-seen times and a **revoke** button.

This fits the offline design. The token is already on the tablet, so an outage
changes nothing. Revocation takes effect when that tablet next reaches the
server, which is correct — a revoked tablet with no network also cannot upload.

The tablets additionally run in **guided access / kiosk mode**, a device setting
rather than code, so nobody can navigate away from the app.

### Proportionality

The worst outcome of a false check-in is an inflated headcount and a slightly
over-ordered kitchen. No money moves and nothing is stolen. Device tokens plus
kiosk mode is the right amount of effort. Signed requests, certificate pinning,
per-card rate limiting, and anomaly detection are all out of scope. Nothing in
any design stops a member scanning a friend's card at the door; that is a social
problem the club already has an answer for.

---

## 10. Admin dashboard

Built in priority order:

| # | Feature | Notes |
|---|---|---|
| 1 | Login | Gates everything |
| 2 | Daily and per-meal headcount charts, rush-hour histogram | The rush histogram is what drives kitchen staffing. It is built from `scanned_at` |
| 3 | Today's count, live | The one number anyone asks for during service |
| 4 | Date-range CSV export | Data freedom, and the escape hatch when a chart does not exist yet |
| 5 | Roster management | CSV upload and/or a page to add and remove members directly |
| 6 | Photo bulk upload | |
| 7 | Member versus guest split | |
| 8 | Guest ledger grouped by home club | |

### Roster management

CSV columns: `netid, full_name, class_year`. `is_member` and `home_club` are
implied, since this is the member roster.

**An upload must show a diff before it applies anything:**

```
  + 47 to add             (incoming class)
  ~  3 to update          (name corrections)
  - 52 to drop membership (graduating seniors, or anyone who left)
```

Dropping membership is inferred from absence — anyone with `is_member = true`
who is not in the file. That inference is powerful, which is exactly why it must
never run unattended. A truncated file applied without a preview would drop the
entire club's membership in one click.

**People are never archived and never deleted. They stop being members.**
Dropping someone sets `is_member = false` and `home_club = 'None'`. Nothing else
changes — the row, the netID, the card binding, and the photo all stay.

This is better than an archive flag for three reasons:

1. **History is already safe** without it, because `swipes.was_member` snapshots
   membership at the moment of each scan. A departed member's past swipes still
   count as member swipes forever.
2. **It handles leaving, not just graduating.** Someone who quits the club in
   their junior year is not archived and gone. They are accurately recorded as a
   non-member from that point on.
3. **They can still eat here as a guest.** An archive flag would have hidden
   them and broken their scan. Instead their card still works, their photo still
   appears, and the swipe is correctly counted as a guest. A returning alum at
   reunions works the same way, with no special case.

Two known limitations, both accepted:

- If a departed member joins another club, `home_club` stays `'None'` until an
  admin corrects it. The guest ledger under-counts that club slightly.
- `people` grows without bound. At a few hundred rows a year, this is not worth
  addressing.

### Photo upload

Bulk select or a zip, with files named by netID (`ab1234.jpg`). The server
resizes each to roughly 400×400 and converts to WebP, **targeting about 40 KB
per photo**. At the spring peak of 300 members that keeps the whole set near
12 MB.

The 40 KB target matters more than it looks. The original design document
assumed 150 photos at roughly 100 KB. At 300 members, that same setting would
produce a 30 MB first-launch download over club Wi-Fi, with three tablets
pulling at once. Compressing harder is what keeps the first launch tolerable,
and a 400×400 WebP at that size still looks sharp at the size it is displayed. Uploading photos bumps the roster version stamp, so tablets pick up
new headshots on their next sync.

### Note on sequencing

The door app needs roster **data** to exist, but it does not need the roster
**upload UI**. If items 5 and 6 land last, the roster and photos are seeded once
through Supabase's table editor or a one-off script for the August 30 test. The
upload UI is what prevents the developer becoming a bottleneck in October; it is
not what gets the system live in September.

---

## 11. Hosting and cost

| Component | Choice | Up front | Per year |
|---|---|---|---|
| Frontend and API | Vercel, Hobby tier | $0 | $0 |
| Database and object storage | Supabase, free tier | $0 | $0 |
| Domain | `meals.capandgownclub.org`, subdomain of the club's | $0 | $0 |
| Tablets, readers, mounts | Club purchase | ~$400 | $0 |
| **Total** | | **~$400** | **$0** |

**Vercel Hobby applies** because this is an unpaid project built for the
developer's own club. The $2,000 fee in the original cost document was waived on
a follow-up call. Hobby's terms prohibit *commercial* use, including paid client
work, so this would not hold if the fee were reinstated.

**Supabase stays on the free tier.** Supabase pauses a free project after 7 days
with no activity, and the original cost document proposed a $25/month upgrade to
prevent this. That is unnecessary. The inactivity timer resets on any request,
so a scheduled job hitting one lightweight endpoint every few days keeps the
project alive. **This saves the club $300 a year.**

The keep-alive job writes a heartbeat row so the dashboard can display when it
last ran. It is the only part of the system nobody will ever look at, and the
only part whose failure is silent until the database has already paused.

> The original cost document needs updating before the next business-manager
> call. Both the $2,000 developer fee and the $300 database line have changed.

---

## 12. Testing and go-live

### The constraint

School starts on September 2. There is no meal before it. **The first real load
test is the live event.**

### What is testable without hardware — nearly everything

The burst detector needs no scanner. One test synthesises keydown events 5 ms
apart ending in Enter and asserts a scan fires. Another types the same string at
human speed and asserts one does **not**. That is the highest-risk piece of
client logic in the system, and it can be fully verified before a reader arrives
in the mail.

The same holds for resolution logic, the outbox, and meal derivation. All four
scan cases are testable against a fake network. Build against a simulated
reader, and hardware becomes a confirmation step rather than a dependency.

### The August 30 on-site checklist

Reserve the day for what is impossible anywhere else.

- [ ] Scan a real card. Record the actual token. **This closes O1.**
- [ ] Scan the same card ten times. Confirm the token is identical every time.
- [ ] Scan a second card. Confirm the tokens differ.
- [ ] Confirm the tablets can reach the internet on club Wi-Fi. Check for a
      captive portal or client isolation.
- [ ] Time a cold bootstrap of the full photo set with three tablets pulling at
      once.
- [ ] **Failure drill.** Pull the router mid-service. Confirm scans continue.
      Restore it. Confirm the backlog uploads with nobody touching anything.
- [ ] Same person on tablet 1 then tablet 2 in one meal. Confirm one count.
- [ ] Unknown card bound on tablet 1. Confirm tablet 2 recognises it after sync.
- [ ] Guest flow with a real non-member.
- [ ] Kiosk mode locked, screen timeout disabled, tablets charging at stations.

### Not worth testing

Load. Three hundred people over a two-hour lunch is a few scans per minute. The
server will not notice.

### The fallback

Keep a clipboard and a printed roster physically at the door for the first few
meals. It costs nothing, and it turns a bad surprise on September 2 into an
inconvenience rather than a lost dinner service. Retire it after a week of clean
meals.

---

## 13. Deliberately deferred

**Schedule exceptions** — breaks and one-off closures. Deferred to **late
October**, before fall break.

Counting is already correct without them. The system counts scans, not meals
served, so a closed day produces no scans and therefore a count of zero, which
is right. The only genuine problem is that averages over calendar days are
skewed by closed days — and the fix for that is in the dashboard query, not the
schema: average over **days that had at least one swipe**, not over calendar
days. With 300 people eating, "a day with zero swipes" and "a day the club was
closed" are the same set.

Deferring costs nothing. Adding the table later breaks no rows and changes no
queries. The cheap version, if wanted:

```sql
schedule_exceptions
  exception_date  date primary key
  note            text          -- 'Fall break'
```

One check when the server derives the meal, one tiny table cached on the tablet
so it can say "the club is closed today", one row in the admin UI. Roughly an
afternoon. The expensive version — per-meal closures and altered hours for
specific dates — should not be built until somebody asks for it.

---

## 14. Timeline

| Window | Focus |
|---|---|
| Now → Aug 18 | Finish spec and implementation plan. **Order hardware. Ask the club for the roster and headshots.** |
| Aug 19 → Aug 23 | Station app: burst detector, resolution, offline behaviour, sync |
| Aug 24 → Aug 28 | Dashboard in priority order |
| Aug 29 | Buffer. Not optional |
| Aug 30 | On-site testing at the club |
| Sept 2 | Live |

The critical path is not the code. It is hardware procurement and getting the
roster and headshots out of the club, and neither is blocked by design work.
Both should start immediately.
