# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the business manager a dashboard that answers the questions the club actually asks — how many ate, when the line peaked, who was a guest — and lets an officer run the system without a developer.

**Architecture:** The dashboard is routes under `/admin` in the same Next.js project. Officers sign in with an email and password held by Supabase Auth; an `admins` table decides who is allowed in. No email is ever sent — an existing admin resets another's password from inside the dashboard. Analytics are SQL, written once in `lib/analytics/` and tested against a real Postgres.

**Tech Stack:** Next.js 16.3.1 (App Router), `@supabase/ssr` for cookie sessions, Tailwind, Recharts for charts, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-16-meal-attendance-system-design.md`

**Predecessors:** `2026-08-16-foundation-and-api.md`, `2026-08-17-station-app.md`, `2026-08-17-offline-app-shell.md` — all complete.

## Task order is the club's priority order

Hammad ranked these on 2026-08-16. Tasks are sequenced to match, so work can stop at any point and what exists is the most valuable subset.

| Rank | Feature | Task |
|---|---|---|
| 1 | Log in | 1 |
| 2 | Headcount charts and rush-hour histogram | 4, 5 |
| 3 | Today's count, live | 6 |
| 4 | Date-range CSV export | 7 |
| 5 | Roster management | 8 |
| 6 | Photo bulk upload | 9 |
| 7 | Member versus guest split | 5 |
| 8 | Guest ledger by club | 5 |

Task 2 (the shell) and Task 3 (device management) are inserted early because nothing else can be reached without them.

## Global Constraints

- **Go-live is 2026-09-02.** The station app is done; this is the remaining work.
- **No email is ever sent.** Supabase's built-in mailer allows 2 messages an hour and refuses any address not on the project team, so magic links and password-reset emails would need a third-party SMTP account that has to outlive the developer. Admins manage each other's passwords in the dashboard instead.
- **The service-role key never reaches the browser.** All privileged reads go through route handlers. Row-level security denies `anon` outright.
- **Timezone is `America/New_York`.** Every date bucket, every "today", every chart axis. Never a Date accessor that reads the machine's zone.
- **Averages divide by days that had swipes, not calendar days.** This is what makes deferring schedule exceptions to late October safe: a closed day produces no swipes and drops out on its own.
- **Charts: load the `dataviz` skill before writing the first line of chart code.** Not optional, and not after the fact.
- **No test that would still pass if the thing it names were broken.**
- **Every task ends with a commit** leaving `npm test`, `npm run test:e2e`, and `npm run build` green. Verify with `set -o pipefail`.

---

### Task 1: Admin authentication

**Files:**
- Create: `lib/auth/admin.ts`, `lib/auth/admin.test.ts`
- Create: `lib/supabase/server.ts`, `lib/supabase/browser.ts`
- Create: `app/admin/login/page.tsx`, `app/admin/login/LoginForm.tsx`
- Create: `app/api/admin/session/route.ts`
- Create: `scripts/create-admin.ts`
- Modify: `package.json` — `@supabase/ssr`, a `create-admin` script

**Interfaces:**
- Produces:
  - `requireAdmin(): Promise<{ userId: string; email: string }>` — throws a redirect when not signed in or not on the allowlist
  - `isAdmin(userId: string): Promise<boolean>`
  - `listAdmins()`, `addAdmin(email, password, addedBy)`, `removeAdmin(userId)`, `resetAdminPassword(userId, password)`

- [x] **Step 1: The first admin problem**

There is no admin, so no admin can create one. `scripts/create-admin.ts` uses the service-role key to create a Supabase Auth user and its `admins` row in one go, run as `npm run create-admin -- <email> <password>`. Document it in the README as a one-time bootstrap.

- [x] **Step 2: Write the failing tests**

`lib/auth/admin.test.ts` must prove:

| Test | Why it matters |
|---|---|
| a user on the allowlist is an admin | |
| **a valid Supabase Auth user NOT on the allowlist is refused** | authentication is not authorisation; anyone who can sign up must not get in |
| a removed admin is refused immediately | an officer who graduates loses access the moment their row goes |
| `addAdmin` creates both the auth user and the allowlist row | one without the other is a broken half-account |
| `addAdmin` records who added them | the audit trail that shared passwords cannot give |
| `resetAdminPassword` changes the password without touching the allowlist | |
| `removeAdmin` deletes the auth user too | leaving it orphaned means the email cannot be re-added later |
| **the last admin cannot remove themselves** | locking every officer out of a live system is unrecoverable without a developer, which is the thing this design exists to avoid |

That last one is the important one. Enforce it in `removeAdmin`.

- [x] **Step 3: Implement**

`lib/supabase/server.ts` wraps `createServerClient` from `@supabase/ssr` with Next's cookie store. `requireAdmin()` reads the session, checks `admins`, and redirects to `/admin/login` on either failure — never distinguishing "not signed in" from "not allowed", so the login page cannot be used to enumerate who is an officer.

- [x] **Step 4: Login page**

Email, password, submit. One error message for every failure: "Those details are not right." Never "no such user".

- [x] **Step 5: Verify and commit**

```bash
set -o pipefail && npm test && npm run build
git commit -m "feat: add admin authentication with an allowlist"
```

---

### Task 2: The dashboard shell

**Files:**
- Create: `app/admin/layout.tsx`, `app/admin/page.tsx`
- Create: `app/admin/Nav.tsx`
- Create: `app/api/admin/signout/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` (Task 1)
- Produces: every `/admin/*` route is behind auth by virtue of the layout

- [x] **Step 1: Layout calls `requireAdmin`**

One call in the layout protects every page beneath it. A page added later is protected by default rather than by remembering.

- [x] **Step 2: Navigation and sign-out**

Links to the sections built in later tasks. Signed-in email visible, so an officer on a shared iPad can see whose account they are using.

- [x] **Step 3: Verify and commit**

An end-to-end test asserts `/admin` redirects to `/admin/login` when signed out. That is the whole security boundary, and it deserves a test in a real browser.

---

### Task 3: Device management

Replaces the browser-console `localStorage` hack currently documented in the README.

**Files:**
- Create: `app/admin/devices/page.tsx`, `app/admin/devices/DeviceList.tsx`
- Create: `app/api/admin/devices/route.ts`, `app/api/admin/devices/[id]/route.ts`

**Interfaces:**
- Consumes: `createEnrollmentCode` (Plan 1), `requireAdmin`
- Produces: `GET/POST /api/admin/devices`, `DELETE /api/admin/devices/[id]` (revoke)

- [x] **Step 1: Tests**

| Test | Why |
|---|---|
| a signed-out request is refused | |
| creating a device returns a code that expires | |
| the list shows last-seen times | how an officer notices a tablet has fallen off the network |
| **revoking sets `revoked_at` rather than deleting the row** | swipes reference `station_id`; deleting would orphan them |
| **a revoked device's token stops authenticating** | end-to-end through `authenticateDevice` |

- [x] **Step 2: Implement and commit**

The page shows each tablet's name, when it was last seen, and a revoke button. Creating one displays the code large enough to read across a room.

---

### Task 4: The analytics queries

All the SQL, in one place, tested against real Postgres before any pixel is drawn.

**Files:**
- Create: `lib/analytics/queries.ts`, `lib/analytics/queries.test.ts`
- Create: `lib/analytics/range.ts`, `lib/analytics/range.test.ts`

**Interfaces:**
- Produces:
  - `type DateRange = { from: string; to: string }` — New York calendar dates, inclusive
  - `presetRange(name: "today" | "week" | "month" | "semester"): DateRange`
  - `dailyHeadcount(range): Promise<{ mealDate: string; mealPeriod: string; total: number; members: number; guests: number }[]>`
  - `rushHistogram(range, bucketMinutes): Promise<{ minuteOfDay: number; count: number }[]>`
  - `todayCount(): Promise<{ mealPeriod: string | null; total: number; members: number; guests: number }>`
  - `guestsByClub(range): Promise<{ homeClub: string; visits: number; people: number }[]>`
  - `swipeRows(range): Promise<ExportRow[]>`

- [x] **Step 1: Write the failing tests**

Seed a known fortnight of swipes, then assert:

| Test | Why it matters |
|---|---|
| daily headcount splits members and guests | uses `was_member`, the snapshot |
| **the split uses `was_member`, not `people.is_member`** | flip a person to member afterwards and the historical numbers must not move |
| a range boundary is inclusive at both ends | off-by-one on the last day of a semester report |
| **`todayCount` uses the New York date** | at 21:00 Pacific it is already tomorrow in New York; "today" must mean the club's today |
| `todayCount` reports the meal currently running, or null | |
| the rush histogram buckets by `scanned_at`, not `received_at` | a tablet that syncs late must not distort the peak |
| **the histogram bucket is a New York minute-of-day** | the axis is wrong by three hours otherwise |
| an empty range returns empty, not an error | a new club officer opening the page in July |
| guests group by `home_club` and count visits and distinct people | "how many Cottage visits" is a different question from "how many Cottage people" |
| **days with no swipes are absent, not zero** | what makes deferring schedule exceptions safe: averages divide by days present |

- [x] **Step 2: Implement and commit**

Use Postgres date functions with an explicit `AT TIME ZONE 'America/New_York'`. Do not compute buckets in JavaScript after fetching rows — with a semester of data that is both slower and easier to get wrong.

---

### Task 5: The charts

**REQUIRED: load the `dataviz` skill before writing any chart code.** Not after.

**Files:**
- Create: `app/admin/analytics/page.tsx`
- Create: `app/admin/analytics/HeadcountChart.tsx`, `RushHistogram.tsx`, `GuestLedger.tsx`
- Create: `app/admin/analytics/RangePicker.tsx`
- Create: `app/api/admin/analytics/route.ts`
- Modify: `package.json` — Recharts

- [x] **Step 1: Load the dataviz skill**

- [x] **Step 2: Headcount over time**

Daily totals across the range, members and guests distinguished. This is the number the kitchen orders against.

- [x] **Step 3: Rush-hour histogram**

Scans bucketed by five minutes across a meal. **This is the chart that earns the project its keep** — it answers "when do we need the second server on the line", which nobody can currently answer at all.

- [x] **Step 4: Guest ledger by club**

A table, not a chart. Sortable by visits.

- [x] **Step 5: Range picker**

Today, this week, this month, this semester, and a custom range. Presets first — a business manager checking Tuesday's lunch should not have to operate a date picker.

- [x] **Step 6: Tests**

Component tests assert the shapes that matter: an empty range renders an empty state rather than a broken axis; a range with one day renders; members and guests are visually distinguishable and labelled, not colour-only.

- [x] **Step 7: Verify and commit**

---

### Task 6: Today's count, live

**Files:**
- Create: `app/admin/page.tsx` — the landing page becomes the live count
- Create: `app/api/admin/today/route.ts`

- [x] **Step 1: The number, large**

Total for the meal currently running, split into members and guests. Refreshes on a short poll — no websockets, no realtime subscription. A number that is thirty seconds stale is fine, and polling is one line that a future club member can understand.

- [x] **Step 2: Tests**

| Test | Why |
|---|---|
| shows the current meal's count | |
| **shows a sensible empty state between meals** | the page is open all day; "0" with no explanation reads as broken |
| the count reflects New York's today | |

- [x] **Step 3: Verify and commit**

---

### Task 7: CSV export

The escape hatch. If a board member wants a number no chart shows, this answers it in Excel in two minutes.

**Files:**
- Create: `app/admin/export/page.tsx`
- Create: `app/api/admin/export/route.ts`
- Create: `lib/analytics/csv.ts`, `lib/analytics/csv.test.ts`

- [x] **Step 1: Tests for the CSV writer**

| Test | Why |
|---|---|
| header row names every column | |
| **a name containing a comma is quoted** | "Smith, Jr" would otherwise shift every later column |
| a name containing a quote is escaped | |
| an empty result still returns headers | an empty file with no header looks like a broken export |
| dates are New York calendar dates | |

Do not reach for a CSV library. The rules are three lines and a dependency here has to survive graduation.

- [x] **Step 2: The endpoint**

One row per swipe: netID, name, member or guest at the time, home club, meal date, meal period, scan time. `Content-Disposition: attachment` with a filename carrying the range.

- [x] **Step 3: Verify and commit**

---

### Task 8: Roster management

**Files:**
- Create: `app/admin/roster/page.tsx`, `RosterUpload.tsx`, `RosterDiff.tsx`, `MemberEditor.tsx`
- Create: `app/api/admin/roster/preview/route.ts`, `app/api/admin/roster/apply/route.ts`
- Create: `lib/roster/diff.ts`, `lib/roster/diff.test.ts`

**Interfaces:**
- Produces:
  - `parseRosterCsv(text): { rows: RosterRow[]; errors: string[] }`
  - `diffRoster(incoming, current): { add: RosterRow[]; update: RosterRow[]; drop: string[] }`

- [x] **Step 1: Tests for the parser and the diff**

| Test | Why it matters |
|---|---|
| parses `netid, full_name, class_year` | |
| tolerates a UTF-8 BOM and CRLF line endings | Excel on Windows produces both, and the business manager uses Excel |
| reports a bad netID by row number, and does not silently drop it | |
| **a duplicate netID in one file is an error, not a last-one-wins** | |
| an empty file is an error, not an instruction to drop everyone | |
| diff classifies additions, name changes, and departures | |
| **a person already `is_member = false` is not listed as a departure again** | otherwise every upload re-drops the same people |
| **the diff never proposes deleting a row** | departures set `is_member = false` and `home_club = 'None'` |

- [x] **Step 2: Preview before apply**

Upload produces a diff on screen and nothing else. A second, explicit action applies it. **The apply endpoint takes the reviewed diff, not the file** — so what the officer confirmed is exactly what runs.

An upload that would drop more than a third of current members shows an extra confirmation. A truncated file is the realistic accident, and the club has 200 people whose access it would silently end.

- [x] **Step 3: Manual editor**

Add one member, correct a name, drop one person. Faster than a CSV round trip for a single typo, which is most of what happens in October.

- [x] **Step 4: Bump the roster version**

Applying anything calls `bumpVersion("roster")` so tablets pick it up on their next sync.

- [x] **Step 5: Verify and commit**

---

### Task 9: Photo upload

**Files:**
- Create: `app/admin/photos/page.tsx`, `PhotoUpload.tsx`
- Create: `app/api/admin/photos/route.ts`
- Create: `app/api/photos/[netid]/route.ts`
- Create: `lib/photos/process.ts`, `lib/photos/process.test.ts`
- Modify: `lib/station/bootstrap.ts` — send the device token when fetching a photo
- Create: `supabase/migrations/0002_photo_storage.sql`

- [x] **Step 1: A private bucket, not a public one**

These are photographs of students, so the bucket is private and reads go through `/api/photos/[netid]`, which requires a valid device token. That matches the posture everywhere else: the anon key gets nothing.

`lib/station/bootstrap.ts`'s `defaultPhotoFetcher` must therefore send the device token. It currently does not — that is a real change, not a detail.

- [x] **Step 2: Processing**

Resize to 400×400, convert to WebP, **target about 40 KB**. At the spring peak of 300 members that keeps the whole set near 12 MB. The original assumption of 100 KB per photo would produce a 30 MB first-launch download over club Wi-Fi with three tablets pulling at once.

- [x] **Step 3: Matching files to people**

Files named `hf4888.jpg` import themselves. Anything else needs a manual match, so the page shows unmatched files and lets an officer assign them. Open question **O6** — how the club's export names its files — is still open, so this must handle both.

- [x] **Step 4: Tests**

| Test | Why |
|---|---|
| a file named for a netID matches that person | |
| a file named for someone not in the roster is reported, not silently dropped | |
| **processing brings a large photo under the size target** | the number the whole cache budget rests on |
| **uploading bumps the roster version** | tablets fetch new headshots on their next sync |
| a non-image file is rejected | |

- [x] **Step 5: Verify and commit**

---

## What this plan deliberately does not build

- **Schedule exceptions** for breaks and closures. Deferred to late October, before fall break. The dashboard's averages already divide by days with swipes, so counts stay correct without them.
- **A real directory lookup** (open question O2). Guests still show as their netID.
- **Realtime updates.** The live count polls. Websockets are more moving parts than a thirty-second-stale number justifies.
- **Any second dashboard user role.** Every admin can do everything. A club board of five does not need permission tiers, and adding them later is a column.


---

## Executed. Two deviations worth recording.

**Photo processing happens in the browser, not on the server.** The plan
assumed server-side resizing. Doing it client-side keeps a heavy image library
out of the dependency list and off a serverless function's memory budget, and
a 300-photo upload sends about 12MB over club Wi-Fi instead of several
hundred.

**Filename matching is stricter than `isValidNetid`.** The looser rule matched
"img" out of `IMG_4471.jpg` and "headshot" out of `headshot.png`. All 196 real
netIDs contain digits, so the filename matcher requires one. `isValidNetid`
stays permissive, because a guest typing an older letters-only netID has a
human watching; a filename guess is silent, and the wrong guess puts somebody
else's face on a student's check-in screen.

Open question **O6** — how the club's export names its photo files — is
therefore no longer blocking. Whatever the names are, the ones that match are
imported and the rest are listed for an officer to assign by hand.
