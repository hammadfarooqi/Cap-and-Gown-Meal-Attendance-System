# Handoff

**For whoever picks this up next.** Written 2026-08-27, with go-live on
**2026-09-02** and on-site testing at the club around **2026-08-30**.

The repository already documents *what* the system does and *why* each
decision was made. This file covers what the repository cannot: the state of
play, how the person you are working with works, and the traps that have
already cost time here.

## Read these first, in order

1. **`docs/specs/2026-08-16-meal-attendance-system-design.md`** — the design.
   Not just what it does, but why each odd-looking decision was made. Read the
   assumptions (A1–A7) and the open questions carefully; several look wrong
   until you know the reasoning.
2. **`README.md`** — how to run it. Written for a club member who has never
   seen the project, because that is who inherits it.
3. **`git log`** — the commit messages are documentation. Each one records
   what changed and, more importantly, what was learned. Several describe bugs
   that are not obvious from the code.

The four plans in `docs/superpowers/plans/` are complete and historical. They
are useful for understanding sequence, not for finding current work.

---

## Where things stand

| | |
|---|---|
| Commits | 64 |
| Unit and integration tests | 455 |
| End-to-end tests | 33 |
| Production | Live, roster loaded, healthy |
| Scope | All four plans complete |

**Everything scoped is built.** The station app, the offline behaviour, the
service worker, the dashboard, roster management, photo upload, and officer
management. The remaining work is verification, iteration on feedback, and
the on-site setup.

**Production** is Vercel Hobby plus Supabase free tier, at
`cap-and-gown-meal-attendance-system.vercel.app`. The real 196-member roster
is loaded. Recurring cost is $0.

---

## How to work with the project's owner

**He writes none of the code and reviews all of it.** He reads commit messages
as the primary record, so write them as explanations rather than summaries —
what changed, what it fixes, and what you learned. He does a deep review pass
over commits periodically.

**Tests are your job, and he has a standing bar for them:** *"Tests need to be
good, they need to be useful, don't make bullshit tests, and they need to
actually be able to find bugs and errors"* — without pulling the project off
timeline. In practice: test the logic that can genuinely be wrong — timing
heuristics, boundary conditions, timezone derivation, constraint behaviour
against a real database, offline and retry paths. Skip render smoke tests,
snapshot tests, and anything that re-tests a library. When you propose a test
suite, say what you are deliberately *not* testing and why.

**He pushes back well, and he is often right.** Several of the better
decisions in this system came from him rejecting a first proposal — dropping
the `status` column, keeping the design simple rather than adding a recovery
queue, restructuring the analytics. Argue your case once with reasoning, then
take the decision.

**He asks for the reasoning, not the conclusion.** "Explain option B to me"
means he wants the trade-off laid out honestly, including where you were
wrong.

**He runs the live testing.** Give him step-by-step instructions with expected
results, and be explicit about what would constitute a bug. He has found real
bugs this way that the test suite missed.

---

## Traps that have already cost time here

Every one of these was hit for real. They are in the commit history, but
finding them again is expensive.

**The foreign key from `enrollment_codes.device_id` blocks deleting a device.**
This has now caused two separate wrong diagnoses — once making a test appear
to fail when the code was right, once silently leaving three orphaned rows in
a live list. Delete the enrollment codes first, or better, revoke instead. The
dashboard never deletes a device that has served meals.

**An inline callback in a `useEffect` dependency array cancels its own
effect.** A parent passing `onFoo={() => ...}` creates a new function every
render; in a dependency array the effect re-runs, its cleanup sets
`cancelled = true`, and the callback never fires. This has bitten twice — the
`now` prop and `onUnenrolled`. Read such props through a ref.

**Faking timers breaks `fake-indexeddb`.** It resolves on real async
scheduling, so `vi.useFakeTimers()` freezes every database call and the test
hangs rather than fails. Use short real durations, or an injectable duration
prop.

**Vitest and Playwright do not read `.env.local`.** Only `next dev` does. Both
configs load it explicitly. If a test fails with "Missing
NEXT_PUBLIC_SUPABASE_URL", that is why.

**Tests share one local Postgres.** They run serially for that reason
(`fileParallelism: false`, Playwright `workers: 1`). Anything asserting on
global state — the admin count, a roster diff — must park the real rows and
restore them afterwards. There are working examples in
`lib/auth/admin.test.ts` and `e2e/admin-roster.spec.ts`.

**The local database holds the real 196-member roster.** A roster diff
compares against every member there is, so a naive test upload reads as
"remove everyone".

**Playwright runs against a production build**, not `next dev`. Turbopack
regenerates chunk hashes on every dev compile, so the service worker caches
one set of bundles and the next load asks for different filenames.

**Piping a test command into `grep` or `tail` hides its exit code.** Use
`set -o pipefail`. A red commit has gone out this way.

**Backticks inside a double-quoted commit message are executed by the shell.**
Use a heredoc with a quoted delimiter.

**A bare number is not a card.** `parseCardSwipe` only treats input as a card
when it carries track sentinels (`%`, `;`, `?`); anything else is a typed
identifier and takes the netID path. Fixtures across the unit and e2e suites
were using strings like `"CARD-1"` and `"10000000000001"` as card tokens, and
they silently stopped exercising the card path the moment typed entry got its
own branch. Use a full stripe in any test that means to test a swipe.

**Test data must not name a real member.** A netID is an email address and git
history is permanent. Fixtures use invented people that carry the same shapes
the real roster has — a duplicated full name, a surname shared four ways,
accents, apostrophes, hyphenated and double surnames. Tests must also not
depend on the current roster, so they still pass in two years.

**Two tests flake under load, and both look like real failures.**
`GuestForm.test.tsx` has taken 233 seconds inside a full run for a `userEvent`
test with a 5-second timeout, then passed in 801ms alone. And the offline
shell test waits for the service worker to take control, which needs about
four seconds alone and has exceeded fifteen inside a full run — its budget is
now 60 seconds for that reason, not because the assertion is soft. If either
goes red on its own, re-run it before hunting a bug.

---

## Things that look wrong and are not

Do not "fix" these without reading the reasoning first.

- **The keep-alive endpoint writes rather than reads.** A read does not reset
  Supabase's inactivity timer; the project paused despite a ping that ran on
  schedule and returned ok every time. See `app/api/keepalive/route.ts`.
- **The tablet does not deduplicate repeat scans.** It queues a second swipe
  and the database's primary key collapses it. The database is the only thing
  that can see all three lanes.
- **A new guest during a network outage is abandoned, not queued.** Spec A6.
  This is the one lossy path and it is deliberate.
- **People are never deleted.** Leaving the club sets `is_member = false`,
  which keeps swipe history attached and lets a departed member still eat as
  somebody's guest.
- **A guest cannot be from Cap & Gown.** The club is removed from the guest
  form's dropdown rather than merely discouraged: somebody standing there is
  either a member, in which case their netID resolves them properly, or they
  are not and the option is a lie.
- **`credentials` maps ONE token to one person, enforced by a unique index.**
  A TigerCard carries two numbers, and the second is the first plus a
  four-digit suffix. Only the 15-digit base is stored, on the bet that the
  base survives a reissue. This reverses the original design, which bound both
  numbers so whichever survived kept working — the index is what makes the
  rule true when two lanes both believe somebody is unbound.
- **`people.directory_name` is not for display, ever.** It holds what the
  University calls somebody; `full_name` holds what the club calls them, and
  that is what goes on a screen. The pair exists because a TigerCard is
  printed from the University's record: 5 of 196 members would not have
  matched their own card without it, four of them a nickname against a legal
  first name. The matcher tries both.
- **`lookupDirectory` returning `unavailable` must never refuse anybody.**
  Only `absent` — the directory saying, definitively, that no such netID
  exists — is allowed to. Confusing the two turns a slow network into a person
  turned away at the door. `lib/directory/ldap.test.ts` talks to the real
  server on purpose, because a mock cannot tell you whether error 32 still
  means what it meant.
- **The card's printed name is never an identity, only a shortlist.** Two
  members share a full name; eight surnames collide; a card carries the name
  of any student, not only a member. The match produces candidate tiles and a
  person always taps their own. See spec A8.
- **`isValidNetid` is strict: two letters, four digits, nothing else.**
  It was deliberately permissive until 2026-08-29, on the reasoning that a
  typed netID has a human watching it. On-site testing reversed that: a
  mistyped netID does not fail, it silently invents a person, records a meal
  against them, and is indistinguishable from a real guest afterwards. All 196
  members match the shape, measured before it was tightened.
  **It guards more than the guest form** — bulk roster upload rejects the
  whole file if one netID fails, so a February roster containing an unusual
  netID fails loudly and all at once. That is intended, but know it before the
  spring upload. The photo filename matcher stays stricter still, because
  guessing a person from a filename is silent and a wrong guess puts the wrong
  face on a screen.
- **Averages divide by days that had swipes, not calendar days.** This is what
  makes deferring schedule exceptions safe.
- **Relative analytics windows disappear for a past semester.** "Today" has no
  referent inside a term that ended.

---

## Running it

```bash
npm install
npx supabase start          # needs Docker
npx supabase db reset       # schema + seed
cp .env.local.example .env.local   # fill from `npx supabase status`
npm run dev
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run create-admin -- <email> <password>` | The one-time bootstrap. No admin exists, so no admin can create one. |
| `npm run load-roster -- <file.csv>` | Load a membership spreadsheet from the terminal. |
| `npm run demo-window` | Open a temporary meal window inside a gap between real meals, so the station can be exercised outside service hours. `-- off` removes it. |

**`db reset` wipes local data**, including the roster and the dev admin. The
roster can be pulled back from production with `supabase db query --linked`.

**Production writes** go through `npx supabase db push` and
`supabase db query --linked`. The CLI holds its own credentials, so the
production service-role key never needs to enter a conversation — do not ask
for it.

**Never commit a roster.** `*.csv` is gitignored. Those files hold real
students' names and email addresses, and git history is permanent.

---

## What is left

### Before the club

1. **Live testing and iteration.** The owner is working through a walkthrough
   covering enrolment, a real card swipe, the offline drill, and every
   dashboard page. Expect feedback on wording and feel as much as on bugs.
   The first-swipe flow changed on 2026-08-27 and has not been through a real
   card yet — only a synthetic one shaped like the measurement.
2. **Headshots** — open question O5. Not blocking: the station falls back to
   initials and every count is correct without them. The upload page handles
   whatever the files are called.
3. **DNS** for `meals.capandgownclub.org` — a CNAME the club has to add.
   Not blocking; the `.vercel.app` address works.
4. **The cost document needs updating** before the next business-manager
   call. Both the $2,000 developer fee and the $300 database line have
   changed; recurring cost is $0.

### At the club, 2026-08-30

The checklist is in the spec, section 12. The two that matter most:

- **`/station/reader-check` on the club's own tablets.** It states plainly
  whether a swipe would be accepted. Thresholds were measured on a laptop; a
  tablet's USB stack may be slower. If it ever says IGNORED, that is the
  moment to re-tune.
- **The failure drill.** Pull the router mid-service, keep scanning, plug it
  back in, watch the backlog upload itself. This runs automatically in the
  e2e suite, but never on that network.

Also: enrol the three real tablets, set kiosk mode, disable screen timeout,
and check the club Wi-Fi for a captive portal or client isolation.

### After go-live

- **An officer tool for card bindings. Deferred 2026-08-27, and the only
  deferred item with a real deadline.** Nothing in the dashboard can view,
  move, or remove a binding, so "please see an officer" currently ends with an
  officer who fetches the person who maintains the system. That is acceptable
  only because neither conflict can happen before cards have been bound at
  all. It must exist well before the February roster jump, when ~100 new
  members arrive with ~100 new cards.
- **O2 — CLOSED 2026-08-29.** Princeton's LDAP directory answers anonymous
  queries from the public internet, verified from Vercel itself. It names a
  hand-typed guest and, more usefully, refuses a netID that cannot exist. See
  `lib/directory/ldap.ts`. Nothing was left of the position below:
- ~~**O2, the directory lookup. Narrowed 2026-08-27.**~~ A guest who SWIPES is now
  named from their card, so this only affects a guest entered by hand, who is
  still stored as their netID. `lib/directory/lookup.ts` is the seam; swapping
  it is the whole change. It has still never been shown to work from a Vercel
  function, and that is the part to prove first.
- **Schedule exceptions** for breaks — deliberately deferred, due before fall
  break in late October.
- **The February roster jump.** The club goes from ~200 to ~300 when the
  incoming class joins, bringing a hundred new headshots and card bindings.
  Roster and photo upload have a second real deadline then.

---

## The one thing to keep hold of

Every serious bug in this project has been **silent**. The keep-alive that
returned ok while the database paused. The burst detector that would have
ignored every swipe. The station that blamed the network for a dead token. The
histogram that put six empty hours on an axis.

None were caught by unit tests. They were caught by **measuring the real
thing, rendering it and looking at it, or someone using it and saying "why
does it do that".**

Keep doing those.
