# Foundation & API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repository, the database schema, the shared meal-derivation logic, and the device-authenticated station API — ending with one real scan travelling the entire path from a simulated card reader to a row in Postgres and a face on screen.

**Architecture:** One Next.js App Router project holds the station app, the dashboard, and the API route handlers, deployed as a single Vercel project. Meal derivation lives in `lib/meals/` and is imported by both the server (authoritative) and the tablet (display only), so the two can never disagree about what a schedule means. Postgres enforces the "counted once per meal" rule through a primary key, which is also what makes the sync queue idempotent.

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind, Supabase (Postgres, Storage, Auth), `idb`, Vitest + Testing Library + `fake-indexeddb`, Playwright, Supabase CLI for local Postgres in Docker.

**Spec:** `docs/specs/2026-08-16-meal-attendance-system-design.md`

## Global Constraints

- **Go-live is 2026-09-02.** On-site testing 2026-08-30. Nothing in this plan may slip past 2026-08-23.
- **A scan must resolve in under 500 ms** on the cache-hit path, with no network call.
- **Recurring cost must stay $0.** Vercel Hobby, Supabase free tier. Do not introduce a paid service.
- **Timezone is `America/New_York`.** All `meal_date` values are New York calendar dates, derived from a UTC `timestamptz`.
- **Meal grace period is 15 minutes** on each side of every window, configurable per row via `meal_schedule.grace_minutes`.
- **Device tokens are stored hashed.** Plaintext tokens exist only on the tablet.
- **No test that would still pass if the thing it names were broken.** No snapshot tests, no render smoke tests, no tests of third-party libraries.
- **Every task ends with a commit** that leaves `npm test` and `npm run build` green.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx` (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `.env.local.example`
- Create: `.gitignore` (via `create-next-app`)

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test`, `npm run build`, and `npm run dev`. Path alias `@/*` resolves to the project root.

- [ ] **Step 1: Scaffold the Next.js project**

Run in the repository root:

```bash
npx create-next-app@latest . \
  --typescript --tailwind --eslint --app \
  --src-dir=false --import-alias "@/*" --use-npm
```

Answer "no" to Turbopack if prompted; it adds a variable we do not need to debug under a deadline.

- [ ] **Step 2: Record the actual Next.js version**

Run: `node -p "require('./package.json').dependencies.next"`

Write the exact version into the "Tech Stack" line of this plan document, replacing "Next.js". Later tasks and any future club developer need to know what was actually installed.

- [ ] **Step 3: Install the test toolchain**

```bash
npm install -D vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/user-event \
  @testing-library/jest-dom fake-indexeddb dotenv
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],

    // Integration tests share one local Postgres and clean up after
    // themselves. Running files in parallel lets one file's teardown delete
    // rows another file is still using, which produces failures that look
    // random and are not. Serial is fast enough at this size.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { config as loadEnv } from "dotenv";

// Vitest does not read .env.local the way `next dev` does. Without this,
// every integration test fails at serviceClient() with "Missing
// NEXT_PUBLIC_SUPABASE_URL", which looks like a code bug and is not.
loadEnv({ path: ".env.local" });

// Every test runs as if the tablet is in the club's timezone.
process.env.TZ = "America/New_York";
```

- [ ] **Step 5: Add test scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Verify the harness runs and the build passes**

Run: `npm test`
Expected: exits 0 with "No test files found" — the runner works, and there is nothing to run yet.

Run: `npm run build`
Expected: build succeeds.

Do not add a placeholder test to prove the runner works. Task 2 writes the first real one.

- [ ] **Step 7: Write the environment template**

Create `.env.local.example`:

```
# Local Supabase (from `supabase start` output)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Vitest harness"
```

---

### Task 2: Local Postgres and the schema

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`
- Create: `supabase/seed.sql`
- Create: `lib/db/client.ts`
- Create: `lib/db/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's project and test harness
- Produces: `serviceClient(): SupabaseClient` from `lib/db/client.ts` — a service-role client for server-side and test use. All eight tables from the spec exist in local Postgres.

- [ ] **Step 1: Start local Supabase**

```bash
npm install -D supabase
npx supabase init
npx supabase start
```

Copy the printed `API URL`, `anon key`, and `service_role key` into `.env.local`.

Docker must be running. If `supabase start` fails, that is the blocker to solve before anything else in this plan.

- [ ] **Step 2: Write the schema migration**

Create `supabase/migrations/0001_initial_schema.sql`:

```sql
create table clubs (
  name text primary key
);

create table people (
  netid       text primary key,
  full_name   text not null,
  is_member   boolean not null default false,
  class_year  int,
  home_club   text references clubs(name),
  photo_path  text
);

create table credentials (
  token      text primary key,
  netid      text not null references people(netid),
  created_at timestamptz not null default now()
);

create table devices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  token_hash   text not null unique,
  enrolled_at  timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

create table enrollment_codes (
  code       text primary key,
  expires_at timestamptz not null,
  used_at    timestamptz,
  device_id  uuid references devices(id)
);

create table swipes (
  netid        text not null references people(netid),
  meal_date    date not null,
  meal_period  text not null,
  was_member   boolean not null,
  scanned_at   timestamptz not null,
  received_at  timestamptz not null default now(),
  station_id   uuid references devices(id),
  entry_method text not null,
  primary key (netid, meal_date, meal_period)
);

create table meal_schedule (
  day_of_week   int  not null,
  period_name   text not null,
  start_time    time not null,
  end_time      time not null,
  grace_minutes int  not null default 15,
  primary key (day_of_week, period_name)
);

create table admins (
  user_id  uuid primary key,
  email    text not null,
  added_at timestamptz not null default now(),
  added_by uuid references admins(user_id)
);

create table versions (
  resource text primary key,
  version  int  not null default 1
);
```

- [ ] **Step 3: Write the seed**

Create `supabase/seed.sql`:

```sql
insert into clubs (name) values
  ('Cap & Gown'), ('Cannon'), ('Charter'), ('Cloister'), ('Colonial'),
  ('Cottage'), ('Ivy'), ('Quadrangle'), ('Terrace'), ('Tiger Inn'),
  ('Tower'), ('None');

insert into versions (resource, version) values
  ('roster', 1), ('schedule', 1);
```

The meal schedule is deliberately not seeded here. Real windows are open question O3 and arrive from the business manager. Tests supply their own.

- [ ] **Step 4: Apply the migration and seed**

```bash
npx supabase db reset
```

Expected: migration and seed both apply with no errors.

- [ ] **Step 5: Write the database client**

Create `lib/db/client.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client. Server-side and tests only — never ship to a browser. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
```

Install the client library:

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 6: Write the failing test for the duplicate-swipe guarantee**

This is the most important test in the plan. The entire sync design rests on Postgres rejecting a second swipe for the same person and meal. A mock would pass while the real constraint failed.

Create `lib/db/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "./client";

const db = serviceClient();
const NETID = "test0001";

beforeAll(async () => {
  await db.from("people").upsert({
    netid: NETID, full_name: "Schema Test", is_member: true, home_club: "Cap & Gown",
  });
});

afterAll(async () => {
  await db.from("swipes").delete().eq("netid", NETID);
  await db.from("people").delete().eq("netid", NETID);
});

describe("swipes primary key", () => {
  it("rejects a second swipe for the same person, date and meal", async () => {
    const row = {
      netid: NETID, meal_date: "2026-09-02", meal_period: "lunch",
      was_member: true, scanned_at: "2026-09-02T16:00:00Z", entry_method: "scan",
    };

    const first = await db.from("swipes").insert(row);
    expect(first.error).toBeNull();

    const second = await db.from("swipes").insert(row);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23505"); // unique_violation
  });

  it("allows the same person at a different meal on the same day", async () => {
    const base = {
      netid: NETID, meal_date: "2026-09-03",
      was_member: true, scanned_at: "2026-09-03T16:00:00Z", entry_method: "scan",
    };

    const lunch = await db.from("swipes").insert({ ...base, meal_period: "lunch" });
    const dinner = await db.from("swipes").insert({ ...base, meal_period: "dinner" });

    expect(lunch.error).toBeNull();
    expect(dinner.error).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npm test lib/db/schema.test.ts`
Expected: PASS. If the first test fails, the primary key is wrong in the migration and every later idempotency claim is void — fix the migration before continuing.

- [ ] **Step 8: Commit**

```bash
git add supabase lib/db package.json package-lock.json
git commit -m "feat: add schema, seed, and db client with constraint tests"
```

---

### Task 3: Meal derivation

The single piece of logic both the server and the tablet run. The server's answer is authoritative; the tablet's drives the message on screen.

**Files:**
- Create: `lib/meals/types.ts`
- Create: `lib/meals/derive.ts`
- Create: `lib/meals/derive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type MealWindow = { dayOfWeek: number; periodName: string; startTime: string; endTime: string; graceMinutes: number }`
  - `type DerivedMeal = { mealDate: string; mealPeriod: string }`
  - `deriveMeal(scannedAt: Date, schedule: MealWindow[]): DerivedMeal | null`

- [ ] **Step 1: Write the types**

Create `lib/meals/types.ts`:

```ts
/** One meal window, as stored in `meal_schedule`. */
export type MealWindow = {
  /** 0 = Sunday, matching Postgres `extract(dow)` and JS `getDay()`. */
  dayOfWeek: number;
  periodName: string;
  /** "HH:MM:SS" in America/New_York. */
  startTime: string;
  endTime: string;
  graceMinutes: number;
};

/** The result of placing a scan into a meal. */
export type DerivedMeal = {
  /** New York calendar date, "YYYY-MM-DD". */
  mealDate: string;
  mealPeriod: string;
};

export const CLUB_TIMEZONE = "America/New_York";
```

- [ ] **Step 2: Write the failing tests**

Create `lib/meals/derive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveMeal } from "./derive";
import type { MealWindow } from "./types";

// Wednesday 2026-09-02 is dayOfWeek 3.
const WEEKDAY: MealWindow[] = [
  { dayOfWeek: 3, periodName: "breakfast", startTime: "08:00:00", endTime: "10:00:00", graceMinutes: 15 },
  { dayOfWeek: 3, periodName: "lunch",     startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
  { dayOfWeek: 3, periodName: "dinner",    startTime: "18:00:00", endTime: "20:00:00", graceMinutes: 15 },
];

/** Build a UTC instant from a New York wall-clock time during EDT (UTC-4). */
const edt = (isoLocal: string) => new Date(`${isoLocal}-04:00`);

describe("deriveMeal", () => {
  it("places a scan inside a window", () => {
    expect(deriveMeal(edt("2026-09-02T12:00:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan inside the trailing grace period", () => {
    // Spec example: lunch ends 13:30, a 13:39 scan still counts.
    expect(deriveMeal(edt("2026-09-02T13:39:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan inside the leading grace period", () => {
    expect(deriveMeal(edt("2026-09-02T11:20:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan exactly on the grace boundary", () => {
    expect(deriveMeal(edt("2026-09-02T13:45:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("rejects a scan one second past the grace boundary", () => {
    expect(deriveMeal(edt("2026-09-02T13:45:01"), WEEKDAY)).toBeNull();
  });

  it("rejects a scan between meals", () => {
    expect(deriveMeal(edt("2026-09-02T15:00:00"), WEEKDAY)).toBeNull();
  });

  it("rejects a scan on a day with no windows", () => {
    // Sunday 2026-09-06 has dayOfWeek 0, absent from WEEKDAY.
    expect(deriveMeal(edt("2026-09-06T12:00:00"), WEEKDAY)).toBeNull();
  });

  it("uses the New York calendar date, not the UTC date", () => {
    // 19:30 New York on 2026-09-02 is 23:30 UTC the same day...
    expect(deriveMeal(edt("2026-09-02T19:30:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "dinner" });
  });

  it("does not roll a late dinner onto the next UTC day", () => {
    // 20:10 New York = 00:10 UTC on 2026-09-03. The meal date must stay 09-02.
    const result = deriveMeal(edt("2026-09-02T20:10:00"), WEEKDAY);
    expect(result).toEqual({ mealDate: "2026-09-02", mealPeriod: "dinner" });
  });

  it("uses the New York weekday, not the UTC weekday", () => {
    // 20:10 New York on Wednesday is Thursday in UTC. It must still match
    // Wednesday's schedule.
    expect(deriveMeal(edt("2026-09-02T20:10:00"), WEEKDAY)?.mealPeriod).toBe("dinner");
  });

  it("handles a standard-time date after the DST change", () => {
    // 2026-11-18 is a Wednesday in EST (UTC-5).
    const est = new Date("2026-11-18T12:00:00-05:00");
    expect(deriveMeal(est, WEEKDAY))
      .toEqual({ mealDate: "2026-11-18", mealPeriod: "lunch" });
  });

  it("returns the first match when windows overlap after grace is applied", () => {
    const overlapping: MealWindow[] = [
      { dayOfWeek: 3, periodName: "lunch",  startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 60 },
      { dayOfWeek: 3, periodName: "dinner", startTime: "14:00:00", endTime: "16:00:00", graceMinutes: 60 },
    ];
    // 13:45 falls in both. Order in the array decides, deterministically.
    expect(deriveMeal(edt("2026-09-02T13:45:00"), overlapping)?.mealPeriod).toBe("lunch");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test lib/meals/derive.test.ts`
Expected: FAIL — `deriveMeal` is not exported from `./derive`.

- [ ] **Step 4: Write the implementation**

Create `lib/meals/derive.ts`:

```ts
import { CLUB_TIMEZONE, type DerivedMeal, type MealWindow } from "./types";

/** Parts of an instant as seen on a wall clock in the club's timezone. */
function clubLocalParts(instant: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CLUB_TIMEZONE,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: weekdays.indexOf(parts.weekday),
    // "24" appears at midnight in some ICU versions; normalise it to 0.
    secondsOfDay:
      (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

function timeToSeconds(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
}

/**
 * Place a scan into a meal, or return null if it falls outside every window.
 *
 * Both the server and the tablet call this. The server's answer is the one
 * that reaches the database; the tablet's only drives the success message.
 * Ties between overlapping windows resolve to the first match in `schedule`,
 * so both callers agree given the same input.
 */
export function deriveMeal(scannedAt: Date, schedule: MealWindow[]): DerivedMeal | null {
  const local = clubLocalParts(scannedAt);

  for (const w of schedule) {
    if (w.dayOfWeek !== local.dayOfWeek) continue;

    const grace = w.graceMinutes * 60;
    const from = timeToSeconds(w.startTime) - grace;
    const to = timeToSeconds(w.endTime) + grace;

    if (local.secondsOfDay >= from && local.secondsOfDay <= to) {
      return { mealDate: local.date, mealPeriod: w.periodName };
    }
  }

  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test lib/meals/derive.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/meals
git commit -m "feat: add shared meal derivation with timezone and grace handling"
```

---

### Task 4: Device enrolment and authentication

**Files:**
- Create: `lib/auth/device.ts`
- Create: `lib/auth/device.test.ts`
- Create: `app/api/devices/enroll/route.ts`

**Interfaces:**
- Consumes: `serviceClient()` from Task 2
- Produces:
  - `hashToken(token: string): string`
  - `createEnrollmentCode(name: string): Promise<{ code: string; expiresAt: string }>`
  - `redeemEnrollmentCode(code: string): Promise<{ deviceId: string; token: string } | null>`
  - `authenticateDevice(req: Request): Promise<{ deviceId: string } | null>`
  - `POST /api/devices/enroll` accepting `{ code: string }` and returning `{ deviceId, token }`

- [ ] **Step 1: Write the failing tests**

Create `lib/auth/device.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { serviceClient } from "@/lib/db/client";
import {
  hashToken, createEnrollmentCode, redeemEnrollmentCode, authenticateDevice,
} from "./device";

const db = serviceClient();

// Devices created here are named with this prefix so cleanup can scope itself
// and never touch a device another test file is relying on.
const PREFIX = "authtest-";

afterEach(async () => {
  const { data } = await db.from("devices").select("id").like("name", `${PREFIX}%`);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
  await db.from("enrollment_codes").delete().is("device_id", null);
});

const withToken = (token: string) =>
  new Request("http://localhost/api/sync", {
    headers: { authorization: `Bearer ${token}` },
  });

describe("device tokens", () => {
  it("never stores the plaintext token", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    const { data } = await db.from("devices").select("token_hash").single();
    expect(data!.token_hash).not.toBe(redeemed!.token);
    expect(data!.token_hash).toBe(hashToken(redeemed!.token));
  });

  it("authenticates a device with a valid token", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    const result = await authenticateDevice(withToken(redeemed!.token));
    expect(result).toEqual({ deviceId: redeemed!.deviceId });
  });

  it("rejects an unknown token", async () => {
    expect(await authenticateDevice(withToken("not-a-real-token"))).toBeNull();
  });

  it("rejects a request with no authorization header", async () => {
    expect(await authenticateDevice(new Request("http://localhost/api/sync"))).toBeNull();
  });

  it("rejects a revoked device", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    await db.from("devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", redeemed!.deviceId);

    expect(await authenticateDevice(withToken(redeemed!.token))).toBeNull();
  });
});

describe("enrollment codes", () => {
  it("refuses a code that has already been used", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    expect(await redeemEnrollmentCode(code)).not.toBeNull();
    expect(await redeemEnrollmentCode(code)).toBeNull();
  });

  it("refuses an expired code", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    await db.from("enrollment_codes")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("code", code);

    expect(await redeemEnrollmentCode(code)).toBeNull();
  });

  it("refuses a code that does not exist", async () => {
    expect(await redeemEnrollmentCode("ZZZZZZZZ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test lib/auth/device.test.ts`
Expected: FAIL — module `./device` has no such exports.

- [ ] **Step 3: Write the implementation**

Create `lib/auth/device.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { serviceClient } from "@/lib/db/client";

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1

/**
 * Device tokens are random 256-bit secrets, so a fast hash is correct here.
 * Password hashing (bcrypt, argon2) defends against guessable inputs; these
 * are not guessable.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function createEnrollmentCode(
  name: string,
): Promise<{ code: string; expiresAt: string }> {
  const db = serviceClient();
  const code = randomCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error } = await db.from("enrollment_codes").insert({
    code, expires_at: expiresAt,
  });
  if (error) throw error;

  // The device name travels with the code until it is redeemed.
  pendingNames.set(code, name);
  return { code, expiresAt };
}

const pendingNames = new Map<string, string>();

export async function redeemEnrollmentCode(
  code: string,
): Promise<{ deviceId: string; token: string } | null> {
  const db = serviceClient();

  const { data: row } = await db
    .from("enrollment_codes")
    .select("code, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const token = randomBytes(32).toString("base64url");

  const { data: device, error } = await db
    .from("devices")
    .insert({ name: pendingNames.get(code) ?? "Unnamed tablet", token_hash: hashToken(token) })
    .select("id")
    .single();
  if (error) throw error;

  await db
    .from("enrollment_codes")
    .update({ used_at: new Date().toISOString(), device_id: device.id })
    .eq("code", code);

  pendingNames.delete(code);
  return { deviceId: device.id, token };
}

export async function authenticateDevice(
  req: Request,
): Promise<{ deviceId: string } | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const db = serviceClient();
  const { data } = await db
    .from("devices")
    .select("id, revoked_at")
    .eq("token_hash", hashToken(header.slice("Bearer ".length)))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  await db
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return { deviceId: data.id };
}
```

Note on `pendingNames`: it is an in-process map, so a code created on one serverless instance and redeemed on another loses the name and falls back to "Unnamed tablet". That is cosmetic, and enrolment is a rare, supervised action. Task 4 of the dashboard plan replaces it by storing the name on the `enrollment_codes` row.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test lib/auth/device.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the enrolment endpoint**

Create `app/api/devices/enroll/route.ts`:

```ts
import { NextResponse } from "next/server";
import { redeemEnrollmentCode } from "@/lib/auth/device";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const result = await redeemEnrollmentCode(body.code);
  if (!result) {
    return NextResponse.json({ error: "invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/auth app/api/devices
git commit -m "feat: add device enrolment and token authentication"
```

---

### Task 5: The response envelope and the bootstrap endpoint

**Files:**
- Create: `lib/api/envelope.ts`
- Create: `lib/api/envelope.test.ts`
- Create: `app/api/bootstrap/route.ts`
- Create: `app/api/bootstrap/route.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice` (Task 4), `serviceClient` (Task 2)
- Produces:
  - `type Versions = { roster: number; schedule: number }`
  - `readVersions(): Promise<Versions>`
  - `bumpVersion(resource: "roster" | "schedule"): Promise<void>`
  - `envelope<T>(data: T): Promise<{ data: T; versions: Versions }>`
  - `GET /api/bootstrap` returning `{ data: { people, credentials, schedule }, versions }`

- [ ] **Step 1: Write the failing tests for versions**

Create `lib/api/envelope.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { readVersions, bumpVersion, envelope } from "./envelope";

const db = serviceClient();

beforeEach(async () => {
  await db.from("versions").upsert([
    { resource: "roster", version: 1 },
    { resource: "schedule", version: 1 },
  ]);
});

describe("versions", () => {
  it("reads both resource versions", async () => {
    expect(await readVersions()).toEqual({ roster: 1, schedule: 1 });
  });

  it("bumps only the named resource", async () => {
    await bumpVersion("roster");
    expect(await readVersions()).toEqual({ roster: 2, schedule: 1 });
  });

  it("wraps data with the current versions", async () => {
    await bumpVersion("schedule");
    expect(await envelope({ hello: "world" })).toEqual({
      data: { hello: "world" },
      versions: { roster: 1, schedule: 2 },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test lib/api/envelope.test.ts`
Expected: FAIL — module `./envelope` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/api/envelope.ts`:

```ts
import { serviceClient } from "@/lib/db/client";

export type Versions = { roster: number; schedule: number };

export async function readVersions(): Promise<Versions> {
  const db = serviceClient();
  const { data, error } = await db.from("versions").select("resource, version");
  if (error) throw error;

  const map = Object.fromEntries(data.map((r) => [r.resource, r.version]));
  return { roster: map.roster ?? 1, schedule: map.schedule ?? 1 };
}

export async function bumpVersion(resource: "roster" | "schedule"): Promise<void> {
  const db = serviceClient();
  const current = await readVersions();
  const { error } = await db
    .from("versions")
    .update({ version: current[resource] + 1 })
    .eq("resource", resource);
  if (error) throw error;
}

/**
 * Every station response carries the current version stamps, so a tablet
 * learns about roster and schedule changes off traffic it was already
 * sending. No polling, no push.
 */
export async function envelope<T>(data: T): Promise<{ data: T; versions: Versions }> {
  return { data, versions: await readVersions() };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test lib/api/envelope.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for bootstrap**

Create `app/api/bootstrap/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { GET } from "./route";

const db = serviceClient();
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode("Test lane");
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("people").upsert({
    netid: "boot0001", full_name: "Bootstrap Member",
    is_member: true, home_club: "Cap & Gown",
  });
  await db.from("credentials").upsert({ token: "TOKEN-BOOT-1", netid: "boot0001" });
  await db.from("meal_schedule").upsert({
    day_of_week: 3, period_name: "lunch",
    start_time: "11:30:00", end_time: "13:30:00", grace_minutes: 15,
  });
});

afterAll(async () => {
  await db.from("credentials").delete().eq("netid", "boot0001");
  await db.from("people").delete().eq("netid", "boot0001");
  await db.from("meal_schedule").delete().eq("day_of_week", 3);
  await db.from("devices").delete().neq("name", "");
  await db.from("enrollment_codes").delete().neq("code", "");
});

const request = (bearer?: string) =>
  new Request("http://localhost/api/bootstrap", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("GET /api/bootstrap", () => {
  it("refuses a request with no device token", async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it("refuses a request with a bad device token", async () => {
    expect((await GET(request("nonsense"))).status).toBe(401);
  });

  it("returns roster, credentials, schedule and versions to an enrolled device", async () => {
    const res = await GET(request(token));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.versions).toEqual({ roster: expect.any(Number), schedule: expect.any(Number) });
    expect(body.data.people).toContainEqual(
      expect.objectContaining({ netid: "boot0001", full_name: "Bootstrap Member" }),
    );
    expect(body.data.credentials).toContainEqual({ token: "TOKEN-BOOT-1", netid: "boot0001" });
    expect(body.data.schedule).toContainEqual(
      expect.objectContaining({ periodName: "lunch", graceMinutes: 15 }),
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test app/api/bootstrap`
Expected: FAIL — `./route` does not export `GET`.

- [ ] **Step 7: Write the bootstrap endpoint**

Create `app/api/bootstrap/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";

export async function GET(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = serviceClient();

  const [people, credentials, schedule] = await Promise.all([
    db.from("people").select("netid, full_name, is_member, home_club, photo_path"),
    db.from("credentials").select("token, netid"),
    db.from("meal_schedule").select("day_of_week, period_name, start_time, end_time, grace_minutes"),
  ]);

  if (people.error || credentials.error || schedule.error) {
    return NextResponse.json({ error: "bootstrap failed" }, { status: 500 });
  }

  return NextResponse.json(
    await envelope({
      people: people.data,
      credentials: credentials.data,
      schedule: schedule.data.map((w) => ({
        dayOfWeek: w.day_of_week,
        periodName: w.period_name,
        startTime: w.start_time,
        endTime: w.end_time,
        graceMinutes: w.grace_minutes,
      })),
    }),
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test app/api/bootstrap`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add lib/api app/api/bootstrap
git commit -m "feat: add version envelope and bootstrap endpoint"
```

---

### Task 6: The resolve endpoint

**Files:**
- Create: `app/api/resolve/route.ts`
- Create: `app/api/resolve/route.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice` (Task 4), `envelope` (Task 5)
- Produces: `POST /api/resolve` accepting `{ token: string }`, returning `{ data: { netid, fullName, isMember, homeClub, photoPath }, versions }` on 200, or 404 when the token is unknown.

- [ ] **Step 1: Write the failing test**

Create `app/api/resolve/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { POST } from "./route";

const db = serviceClient();
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode("Test lane");
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("people").upsert({
    netid: "res00001", full_name: "Resolve Member",
    is_member: true, home_club: "Cap & Gown", photo_path: "res00001.webp",
  });
  await db.from("credentials").upsert({ token: "TOKEN-RES-1", netid: "res00001" });
});

afterAll(async () => {
  await db.from("credentials").delete().eq("netid", "res00001");
  await db.from("people").delete().eq("netid", "res00001");
  await db.from("devices").delete().neq("name", "");
  await db.from("enrollment_codes").delete().neq("code", "");
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/resolve", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request({ token: "TOKEN-RES-1" }))).status).toBe(401);
  });

  it("returns the person behind a known card token", async () => {
    const res = await POST(request({ token: "TOKEN-RES-1" }, token));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual({
      netid: "res00001",
      fullName: "Resolve Member",
      isMember: true,
      homeClub: "Cap & Gown",
      photoPath: "res00001.webp",
    });
    expect(body.versions.roster).toEqual(expect.any(Number));
  });

  it("returns 404 for a card token nobody has bound", async () => {
    expect((await POST(request({ token: "TOKEN-UNKNOWN" }, token))).status).toBe(404);
  });

  it("returns 400 when the body has no token", async () => {
    expect((await POST(request({}, token))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test app/api/resolve`
Expected: FAIL — `./route` does not export `POST`.

- [ ] **Step 3: Write the implementation**

Create `app/api/resolve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";

export async function POST(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const db = serviceClient();
  const { data } = await db
    .from("credentials")
    .select("netid, people(netid, full_name, is_member, home_club, photo_path)")
    .eq("token", body.token)
    .maybeSingle();

  const person = data?.people as
    | { netid: string; full_name: string; is_member: boolean; home_club: string | null; photo_path: string | null }
    | undefined;

  if (!person) {
    return NextResponse.json({ error: "unknown token" }, { status: 404 });
  }

  return NextResponse.json(
    await envelope({
      netid: person.netid,
      fullName: person.full_name,
      isMember: person.is_member,
      homeClub: person.home_club,
      photoPath: person.photo_path,
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test app/api/resolve`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/resolve
git commit -m "feat: add resolve endpoint for unknown card tokens"
```

---

### Task 7: The sync endpoint

The endpoint the whole offline design depends on. It must accept the same batch any number of times and produce the same database state.

**Files:**
- Create: `app/api/sync/route.ts`
- Create: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice` (Task 4), `deriveMeal` (Task 3), `envelope` (Task 5)
- Produces: `POST /api/sync` accepting `{ swipes: Array<{ netid: string; scannedAt: string; entryMethod: "scan" | "manual" }> }`, returning `{ data: { accepted: number; skipped: number }, versions }`

- [ ] **Step 1: Write the failing tests**

Create `app/api/sync/route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { POST } from "./route";

const db = serviceClient();
let token: string;

// Wednesday 2026-09-02, 12:00 New York.
const DURING_LUNCH = "2026-09-02T16:00:00.000Z";
// Wednesday 2026-09-02, 15:00 New York — between meals.
const BETWEEN_MEALS = "2026-09-02T19:00:00.000Z";

beforeAll(async () => {
  const { code } = await createEnrollmentCode("Test lane");
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("meal_schedule").upsert({
    day_of_week: 3, period_name: "lunch",
    start_time: "11:30:00", end_time: "13:30:00", grace_minutes: 15,
  });
  await db.from("people").upsert([
    { netid: "sync0001", full_name: "Sync Member", is_member: true,  home_club: "Cap & Gown" },
    { netid: "sync0002", full_name: "Sync Guest",  is_member: false, home_club: "Cottage" },
  ]);
});

beforeEach(async () => {
  await db.from("swipes").delete().in("netid", ["sync0001", "sync0002"]);
});

afterAll(async () => {
  await db.from("swipes").delete().in("netid", ["sync0001", "sync0002"]);
  await db.from("people").delete().in("netid", ["sync0001", "sync0002"]);
  await db.from("meal_schedule").delete().eq("day_of_week", 3);
  await db.from("devices").delete().neq("name", "");
  await db.from("enrollment_codes").delete().neq("code", "");
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

const oneSwipe = (netid: string, scannedAt = DURING_LUNCH) => ({
  swipes: [{ netid, scannedAt, entryMethod: "scan" }],
});

describe("POST /api/sync", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request(oneSwipe("sync0001")))).status).toBe(401);
  });

  it("records a swipe and derives its meal server-side", async () => {
    const res = await POST(request(oneSwipe("sync0001"), token));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ accepted: 1, skipped: 0 });

    const { data } = await db.from("swipes").select("*").eq("netid", "sync0001").single();
    expect(data!.meal_date).toBe("2026-09-02");
    expect(data!.meal_period).toBe("lunch");
  });

  it("is idempotent — sending the same batch three times leaves one row", async () => {
    await POST(request(oneSwipe("sync0001"), token));
    await POST(request(oneSwipe("sync0001"), token));
    const third = await POST(request(oneSwipe("sync0001"), token));

    expect(third.status).toBe(200);
    expect((await third.json()).data).toEqual({ accepted: 0, skipped: 1 });

    const { count } = await db
      .from("swipes").select("*", { count: "exact", head: true }).eq("netid", "sync0001");
    expect(count).toBe(1);
  });

  it("keeps the FIRST scan time when a duplicate arrives later", async () => {
    await POST(request(oneSwipe("sync0001", "2026-09-02T16:00:00.000Z"), token));
    await POST(request(oneSwipe("sync0001", "2026-09-02T16:30:00.000Z"), token));

    const { data } = await db.from("swipes").select("scanned_at").eq("netid", "sync0001").single();
    expect(new Date(data!.scanned_at).toISOString()).toBe("2026-09-02T16:00:00.000Z");
  });

  it("snapshots membership onto the swipe", async () => {
    await POST(request(oneSwipe("sync0002"), token));

    const { data } = await db.from("swipes").select("was_member").eq("netid", "sync0002").single();
    expect(data!.was_member).toBe(false);
  });

  it("skips a scan that falls outside every meal window", async () => {
    const res = await POST(request(oneSwipe("sync0001", BETWEEN_MEALS), token));
    expect((await res.json()).data).toEqual({ accepted: 0, skipped: 1 });

    const { count } = await db
      .from("swipes").select("*", { count: "exact", head: true }).eq("netid", "sync0001");
    expect(count).toBe(0);
  });

  it("accepts a mixed batch without letting one bad item lose the good ones", async () => {
    const res = await POST(request({
      swipes: [
        { netid: "sync0001", scannedAt: DURING_LUNCH,  entryMethod: "scan" },
        { netid: "sync0002", scannedAt: BETWEEN_MEALS, entryMethod: "scan" },
      ],
    }, token));

    expect((await res.json()).data).toEqual({ accepted: 1, skipped: 1 });
  });

  it("records which tablet took the swipe", async () => {
    await POST(request(oneSwipe("sync0001"), token));

    const { data } = await db.from("swipes").select("station_id").eq("netid", "sync0001").single();
    expect(data!.station_id).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test app/api/sync`
Expected: FAIL — `./route` does not export `POST`.

- [ ] **Step 3: Write the implementation**

Create `app/api/sync/route.ts`:

```ts
import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";
import { deriveMeal } from "@/lib/meals/derive";
import type { MealWindow } from "@/lib/meals/types";

type IncomingSwipe = {
  netid: string;
  scannedAt: string;
  entryMethod: "scan" | "manual";
};

const UNIQUE_VIOLATION = "23505";

export async function POST(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.swipes)) {
    return NextResponse.json({ error: "swipes array required" }, { status: 400 });
  }

  const db = serviceClient();

  const { data: rows, error: scheduleError } = await db
    .from("meal_schedule")
    .select("day_of_week, period_name, start_time, end_time, grace_minutes");
  if (scheduleError) {
    return NextResponse.json({ error: "schedule unavailable" }, { status: 500 });
  }

  const schedule: MealWindow[] = rows.map((w) => ({
    dayOfWeek: w.day_of_week,
    periodName: w.period_name,
    startTime: w.start_time,
    endTime: w.end_time,
    graceMinutes: w.grace_minutes,
  }));

  let accepted = 0;
  let skipped = 0;

  for (const swipe of body.swipes as IncomingSwipe[]) {
    const meal = deriveMeal(new Date(swipe.scannedAt), schedule);
    if (!meal) {
      // Outside every window. Nobody ate, so there is nothing to record.
      skipped += 1;
      continue;
    }

    const { data: person } = await db
      .from("people").select("is_member").eq("netid", swipe.netid).maybeSingle();
    if (!person) {
      skipped += 1;
      continue;
    }

    const { error } = await db.from("swipes").insert({
      netid: swipe.netid,
      meal_date: meal.mealDate,
      meal_period: meal.mealPeriod,
      was_member: person.is_member,
      scanned_at: swipe.scannedAt,
      station_id: device.deviceId,
      entry_method: swipe.entryMethod,
    });

    if (!error) {
      accepted += 1;
    } else if (error.code === UNIQUE_VIOLATION) {
      // Already counted. This is the whole point: re-sending a batch is free,
      // so the tablet never needs an acknowledgement protocol.
      skipped += 1;
    } else {
      throw error;
    }
  }

  return NextResponse.json(await envelope({ accepted, skipped }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test app/api/sync`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/sync
git commit -m "feat: add idempotent sync endpoint with server-side meal derivation"
```

---

### Task 8: The walking skeleton

One scan travelling the whole path. Deliberately crude — no offline cache, no outbox, no prompt, no styling beyond the minimum. Plan 2 replaces almost all of this. What it proves is that the pieces connect.

**Files:**
- Create: `lib/scan/burst.ts`
- Create: `lib/scan/burst.test.ts`
- Create: `app/station/page.tsx`
- Create: `e2e/skeleton.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: `POST /api/resolve` (Task 6), `POST /api/sync` (Task 7)
- Produces: `onScan(handler: (token: string) => void, options?: BurstOptions): () => void` — attaches a document-level listener and returns a detach function.

- [ ] **Step 1: Write the failing tests for the burst detector**

Create `lib/scan/burst.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { onScan } from "./burst";

let detach: (() => void) | undefined;
afterEach(() => { detach?.(); detach = undefined; });

/** Type a string into the document, `gapMs` between each key, then Enter. */
async function type(text: string, gapMs: number) {
  for (const ch of text) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("onScan", () => {
  it("fires for a machine-speed burst ending in Enter", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledExactlyOnceWith("12345678901234");
  });

  it("does NOT fire for human-speed typing", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    // 80ms between keys is slower than the 50ms gap threshold, so the buffer
    // clears repeatedly and Enter arrives with at most one character.
    await type("hf4888", 80);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire for a burst shorter than the minimum token length", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("123", 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores modifier and navigation keys inside a burst", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledExactlyOnceWith("12345678901234");
  });

  it("recovers after a partial burst, so a stray keypress cannot poison the next scan", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    // Someone leans on a key, then walks away.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await new Promise((r) => setTimeout(r, 120));

    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledExactlyOnceWith("12345678901234");
  });

  it("fires twice for two consecutive scans", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("11111111111111", 2);
    await type("22222222222222", 2);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, "11111111111111");
    expect(handler).toHaveBeenNthCalledWith(2, "22222222222222");
  });

  it("stops listening after detach", async () => {
    const handler = vi.fn();
    const stop = onScan(handler);
    stop();

    await type("12345678901234", 2);

    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test lib/scan/burst.test.ts`
Expected: FAIL — module `./burst` not found.

- [ ] **Step 3: Write the burst detector**

Create `lib/scan/burst.ts`:

```ts
export type BurstOptions = {
  /** Shortest plausible card token. */
  minTokenLength?: number;
  /** Longest plausible whole-burst duration, first key to Enter. */
  maxBurstMs?: number;
  /** Longest plausible gap between two keys of the same burst. */
  gapMs?: number;
};

// Starting values. Tuned against real hardware on 2026-08-30.
const DEFAULTS = { minTokenLength: 6, maxBurstMs: 200, gapMs: 50 } as const;

/**
 * Listen for card-reader bursts anywhere on the page.
 *
 * A reader is a very fast keyboard. Rather than fight to keep a text input
 * focused, watch the whole document and decide from the timing whether what
 * arrived was a machine or a person. When it was a person, do nothing and let
 * the event reach whatever had focus, so ordinary typing still works.
 */
export function onScan(
  handler: (token: string) => void,
  options: BurstOptions = {},
): () => void {
  const { minTokenLength, maxBurstMs, gapMs } = { ...DEFAULTS, ...options };

  let buffer = "";
  let burstStartedAt = 0;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    buffer = "";
    burstStartedAt = 0;
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = undefined;
  };

  const listener = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const elapsed = Date.now() - burstStartedAt;
      const looksLikeScan = buffer.length >= minTokenLength && elapsed <= maxBurstMs;
      const token = buffer;
      reset();

      if (looksLikeScan) {
        e.preventDefault();
        handler(token);
      }
      // Otherwise do nothing: a human pressed Enter, and whatever has focus
      // should handle it normally.
      return;
    }

    // Modifiers, arrows, function keys: `key` is a word, not a character.
    if (e.key.length !== 1) return;

    if (buffer === "") burstStartedAt = Date.now();
    buffer += e.key;

    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = setTimeout(reset, gapMs);
  };

  document.addEventListener("keydown", listener);
  return () => {
    document.removeEventListener("keydown", listener);
    reset();
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test lib/scan/burst.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit the detector**

```bash
git add lib/scan
git commit -m "feat: add card-reader burst detector"
```

- [ ] **Step 6: Build the skeleton station page**

Create `app/station/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { onScan } from "@/lib/scan/burst";

type Person = { netid: string; fullName: string; isMember: boolean };
type Status =
  | { kind: "idle" }
  | { kind: "success"; person: Person }
  | { kind: "unknown" }
  | { kind: "failed" };

/**
 * Walking skeleton. No local cache, no outbox, no prompt — every scan goes
 * straight to the server. Plan 2 replaces this with the offline-first version.
 */
export default function StationPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    const deviceToken = localStorage.getItem("deviceToken") ?? "";

    return onScan(async (token) => {
      try {
        const resolved = await fetch("/api/resolve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deviceToken}`,
          },
          body: JSON.stringify({ token }),
        });

        if (resolved.status === 404) {
          setStatus({ kind: "unknown" });
          return;
        }
        if (!resolved.ok) {
          setStatus({ kind: "failed" });
          return;
        }

        const person: Person = (await resolved.json()).data;

        await fetch("/api/sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deviceToken}`,
          },
          body: JSON.stringify({
            swipes: [{
              netid: person.netid,
              scannedAt: new Date().toISOString(),
              entryMethod: "scan",
            }],
          }),
        });

        setStatus({ kind: "success", person });
      } catch {
        setStatus({ kind: "failed" });
      }
    });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      {status.kind === "idle" && (
        <p data-testid="idle" className="text-2xl text-gray-500">Scan your card</p>
      )}
      {status.kind === "success" && (
        <>
          <p data-testid="name" className="text-5xl font-semibold">{status.person.fullName}</p>
          <p data-testid="checked-in" className="text-2xl text-green-700">Checked in</p>
        </>
      )}
      {status.kind === "unknown" && (
        <p data-testid="unknown" className="text-3xl text-amber-700">Card not recognised</p>
      )}
      {status.kind === "failed" && (
        <p data-testid="failed" className="text-3xl text-red-700">
          Could not reach the server — not counted
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Set up Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// The spec files talk to Postgres directly to set up and assert state, so
// they need the same environment the app has. Playwright runs them in plain
// Node, which does not read .env.local on its own.
loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // These tests share one local Postgres. Same reason as vitest.
  workers: 1,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
});
```

Add to `package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 8: Write the end-to-end skeleton test**

Create `e2e/skeleton.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createEnrollmentCode, redeemEnrollmentCode } from "../lib/auth/device";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const CARD = "98765432109876";
const NETID = "e2e00001";

test.beforeEach(async () => {
  const now = new Date();
  // A window that is guaranteed to be open right now, whatever time it is.
  await db.from("meal_schedule").upsert({
    day_of_week: now.getDay(),
    period_name: "e2e",
    start_time: "00:00:00",
    end_time: "23:59:59",
    grace_minutes: 0,
  });
  await db.from("people").upsert({
    netid: NETID, full_name: "Skeleton Student", is_member: true, home_club: "Cap & Gown",
  });
  await db.from("credentials").upsert({ token: CARD, netid: NETID });
  await db.from("swipes").delete().eq("netid", NETID);
});

test.afterEach(async () => {
  await db.from("swipes").delete().eq("netid", NETID);
  await db.from("credentials").delete().eq("netid", NETID);
  await db.from("people").delete().eq("netid", NETID);
  await db.from("meal_schedule").delete().eq("period_name", "e2e");
  await db.from("devices").delete().neq("name", "");
  await db.from("enrollment_codes").delete().neq("code", "");
});

test("a card burst produces a name on screen and a row in Postgres", async ({ page }) => {
  const { code } = await createEnrollmentCode("E2E lane");
  const { token } = (await redeemEnrollmentCode(code))!;

  await page.goto("/station");
  await page.evaluate((t) => localStorage.setItem("deviceToken", t), token);
  await page.reload();

  await expect(page.getByTestId("idle")).toBeVisible();

  // Type at reader speed: 2ms between keys, terminated by Enter.
  for (const ch of CARD) {
    await page.keyboard.press(ch, { delay: 2 });
  }
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("name")).toHaveText("Skeleton Student");
  await expect(page.getByTestId("checked-in")).toBeVisible();

  const { data } = await db.from("swipes").select("*").eq("netid", NETID).single();
  expect(data).not.toBeNull();
  expect(data!.entry_method).toBe("scan");
});
```

- [ ] **Step 9: Run the end-to-end test**

Run: `npm run test:e2e`
Expected: PASS, 1 test. Local Supabase must be running.

- [ ] **Step 10: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all unit and integration tests pass, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add app/station e2e playwright.config.ts package.json package-lock.json
git commit -m "feat: walking skeleton — card burst to database row"
```

---

### Task 9: Deploy to Vercel and Supabase

Do this now, not in week two. Deployment problems found on 2026-08-19 are an afternoon; found on 2026-08-29 they are the project.

**Files:**
- Create: `app/api/keepalive/route.ts`
- Create: `.github/workflows/keepalive.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `serviceClient` (Task 2)
- Produces: `GET /api/keepalive` returning `{ ok: true, at: string }`. A live deployment at the production URL.

- [ ] **Step 1: Create the hosted Supabase project**

Create a free project at supabase.com. Then push the schema:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Run the seed against the hosted database using the SQL editor, pasting `supabase/seed.sql`.

- [ ] **Step 2: Write the keep-alive endpoint**

This is what replaces the $25/month Supabase Pro upgrade. Supabase pauses a free project after 7 days without a request; any query resets the timer.

Create `app/api/keepalive/route.ts`:

```ts
import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/db/client";

export async function GET() {
  // Any real query resets Supabase's inactivity timer.
  const { error } = await serviceClient().from("versions").select("resource").limit(1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
```

- [ ] **Step 3: Schedule the keep-alive**

Create `.github/workflows/keepalive.yml`:

```yaml
name: Supabase keep-alive

on:
  schedule:
    # 09:00 UTC every Monday and Thursday — well inside the 7-day window.
    - cron: "0 9 * * 1,4"
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping the keep-alive endpoint
        run: |
          curl --fail --silent --show-error \
            "https://meals.capandgownclub.org/api/keepalive"
```

GitHub Actions is used rather than Vercel Cron because Vercel's Hobby tier limits cron frequency, and because this job must keep running even if the Vercel project is ever reconfigured.

- [ ] **Step 4: Deploy to Vercel**

Import the repository into a new Vercel project. Set these environment variables from the hosted Supabase project settings:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` must **not** be prefixed `NEXT_PUBLIC_`. That prefix ships a value to the browser, and this key bypasses every access rule in the database.

- [ ] **Step 5: Point the subdomain**

Add `meals.capandgownclub.org` as a domain in the Vercel project, then add the CNAME record Vercel provides to the club's DNS.

- [ ] **Step 6: Verify the deployment**

Run:

```bash
curl -s https://meals.capandgownclub.org/api/keepalive
curl -s -o /dev/null -w "%{http_code}\n" https://meals.capandgownclub.org/api/bootstrap
```

Expected: the first returns `{"ok":true,...}`. The second returns `401`, proving an unenrolled device is refused in production.

- [ ] **Step 7: Write the README**

Replace `README.md` with setup instructions covering: prerequisites (Node, Docker), `npx supabase start`, copying `.env.local.example` to `.env.local`, `npm run dev`, `npm test`, `npm run test:e2e`, and where the spec and plans live. Write it for a club member who has never seen the project, because that is who will read it after you graduate.

- [ ] **Step 8: Commit**

```bash
git add app/api/keepalive .github README.md
git commit -m "feat: add keep-alive endpoint and deploy to production"
```

---

## What this plan deliberately does not build

These belong to Plan 2 (Station App) and Plan 3 (Admin Dashboard). Listing them here so their absence reads as a decision rather than an omission.

- The local cache, the photo cache in IndexedDB, and the outbox
- The unknown-token prompt, the member picker, and guest creation
- The offline member-binding path
- Real screens, real styling, and the timed success clear
- The directory lookup for netID validation (open question O2)
- All dashboard features, admin authentication, and the roster and photo upload

The station page from Task 8 is scaffolding. Plan 2 replaces its internals entirely; only `lib/scan/burst.ts` survives unchanged.
