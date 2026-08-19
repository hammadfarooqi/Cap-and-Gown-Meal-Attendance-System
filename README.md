# Cap & Gown Meal Attendance System

A meal check-in system for the Cap & Gown Club. A student scans their Princeton
ID at a tablet, the screen shows their photo and name, and the system records
that they ate. An admin dashboard turns those records into counts the club can
act on.

This README is written for someone who has never seen the project — most
likely a future club member picking it up. Start here.

---

## What you need installed

| Tool | Why |
|---|---|
| **Node.js 20 or newer** | Runs the app. Built against Node 25. |
| **Docker Desktop**, running | Hosts the local Postgres database for development and tests. |

You do not need a Supabase account to develop or run the tests. Everything runs
on your own machine.

## Getting it running

```bash
npm install

# Starts a local Postgres, storage, and auth stack inside Docker.
# The first run downloads several images and takes a few minutes.
npx supabase start

# Applies the schema and the seed data (the eleven eating clubs).
npx supabase db reset
```

Then create your environment file:

```bash
cp .env.local.example .env.local
```

Fill it in from the output of `npx supabase start`. If you have closed that
terminal, `npx supabase status` prints the same values again. These local keys
are identical on every machine and are not secrets.

```bash
npm run dev
```

The station app is at http://localhost:3000/station.

**It will not do anything until a device is enrolled.** See below.

## Enrolling a tablet

The station app refuses to work until the browser holds a device token. This is
deliberate: without it, anyone who learns the URL could open the page on their
phone and check themselves in.

Sign in to the dashboard, open **Tablets**, give the tablet a name, and press
**Get a code**. On the tablet, open `/station` and type the code in. It expires
after fifteen minutes.

To sign in you first need an account. There is no admin yet, so no admin can
create one — this is the one-time bootstrap:

```bash
npm run create-admin -- you@princeton.edu 'a good long password'
```

Every account after that is created inside the dashboard, under **Officers**.

## Running the tests

```bash
npm test          # unit and integration tests (needs Docker + supabase start)
npm run test:e2e  # end-to-end tests in a real browser (needs the same)
npm run build     # production build
```

Two things worth knowing:

- **Test files run serially.** They share one local Postgres and clean up after
  themselves, so running them in parallel lets one file's teardown delete rows
  another is still using.
- **The end-to-end tests use port 3100, not 3000**, and always start their own
  server. Port 3000 is the default for every Next.js project, and reusing
  whatever happens to be listening silently runs the suite against a different
  application.

## How the code is laid out

```
app/
  station/          the tablet app
  admin/            the dashboard (not built yet)
  api/              route handlers
lib/
  meals/            schedule and meal derivation — used by BOTH tablet and server
  scan/             card-reader burst detector
  auth/             device enrolment and tokens
  api/              the version envelope
  db/               database client
supabase/
  migrations/       the schema
  seed.sql          the eleven eating clubs
docs/
  specs/            the system design — read this first
  superpowers/plans/  implementation plans
  source/           the original client documents
```

`lib/meals/derive.ts` is the one piece of logic both the tablet and the server
run. The tablet uses it to say "checked in for lunch"; the server uses it to
decide what goes in the database. If you change it, you change both.

## Where to read next

**`docs/specs/2026-08-16-meal-attendance-system-design.md`** is the design
document. It explains not just what the system does but why each decision was
made, including the ones that look odd — why people are never deleted, why
duplicate swipes are silently ignored, and why a guest can be lost during a
network outage on purpose.

## Operations

- **Hosting:** Vercel Hobby tier. **Database and storage:** Supabase free tier.
  Recurring cost is $0.
- **The keep-alive job matters.** Supabase pauses a free project after 7 days
  with no requests. `.github/workflows/keepalive.yml` pings the database twice
  a week to prevent that. If it is ever disabled, the database will pause over
  a long break and the first scan back will fail. This is the only part of the
  system nobody looks at and the only one whose failure is silent.
