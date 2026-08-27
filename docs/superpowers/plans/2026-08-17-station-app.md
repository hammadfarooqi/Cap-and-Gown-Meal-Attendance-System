# Station App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the walking skeleton with the real offline-first station app — local cache, photo cache, outbox, four-case scan resolution, and the member-or-guest prompt — so a tablet serves an entire meal rush without touching the network.

**Architecture:** IndexedDB holds everything a tablet needs: the token map, the roster, the headshots, the schedule, and an outbox of unsent work. A scan resolves against that cache with no network call. Only the first sight of a token reaches the server. A background loop drains the outbox, and every response carries version stamps that tell the tablet when to refresh.

**Tech Stack:** Next.js 16.3.1 (App Router, TypeScript), React 19.2.8, Tailwind, `idb`, Vitest + `fake-indexeddb`, Playwright.

**Spec:** `docs/specs/2026-08-16-meal-attendance-system-design.md`

**Predecessor:** `docs/superpowers/plans/2026-08-16-foundation-and-api.md` (complete)

## Global Constraints

- **Go-live is 2026-09-02.** On-site testing 2026-08-30.
- **A cache-hit scan must resolve in under 500 ms with zero network calls.** This is the tenet the whole design serves.
- **Any operation that needs the server gets 3 seconds total** — roughly a 1-second timeout with two retries — then it is abandoned. Nothing is queued for later recovery. See spec A6.
- **Timezone is `America/New_York`.** Never `getDay()`, `getHours()`, or any Date accessor that reads the machine's zone. This has already caused one real bug.
- **Test fixtures that insert meal windows must not overlap the seeded schedule.** `deriveMeal` returns the first match. Use 03:00–04:00, which is clear of every service hour.
- **No test that would still pass if the thing it names were broken.**
- **Every task ends with a commit** leaving `npm test`, `npm run test:e2e`, and `npm run build` green. Verify with `set -o pipefail` — piping to `tail` hides the exit code and has already let one red commit through.

## A note on this plan's form

Plan 1 carried full implementation bodies because it was written to be handed to a fresh worker. This plan is executed by its author within minutes of being written, so it carries **complete test code** — which is the real specification of each task — plus exact interfaces and implementations for the non-obvious modules. Straightforward React rendering is specified by its tests and its interface rather than transcribed twice.

---

### Task 1: The local store

Everything the tablet knows, in IndexedDB. One module owns the schema so nothing else writes raw object stores.

**Files:**
- Create: `lib/station/store.ts`
- Create: `lib/station/store.test.ts`
- Modify: `package.json` (add `idb`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type CachedPerson = { netid: string; fullName: string; isMember: boolean; homeClub: string | null; photoPath: string | null }`
  - `type OutboxItem = { id?: number } & ({ kind: "swipe"; netid: string; scannedAt: string; entryMethod: "scan" | "manual" } | { kind: "binding"; token: string; netid: string })`
  - `openStore(): Promise<StationStore>` where `StationStore` exposes:
    - `putBootstrap(data: { people: CachedPerson[]; credentials: { token: string; netid: string }[]; schedule: MealWindow[]; versions: Versions }): Promise<void>`
    - `resolveToken(token: string): Promise<CachedPerson | null>`
    - `addCredential(token: string, netid: string): Promise<void>`
    - `putPerson(person: CachedPerson): Promise<void>`
    - `allMembers(): Promise<CachedPerson[]>`
    - `unboundMembers(): Promise<CachedPerson[]>`
    - `getSchedule(): Promise<MealWindow[]>`
    - `getVersions(): Promise<Versions | null>`
    - `putVersions(v: Versions): Promise<void>`
    - `putPhoto(path: string, blob: Blob): Promise<void>`
    - `getPhoto(path: string): Promise<Blob | undefined>`
    - `hasPhoto(path: string): Promise<boolean>`
    - `enqueue(item: OutboxItem): Promise<void>`
    - `peekOutbox(limit?: number): Promise<Required<OutboxItem>[]>`
    - `removeFromOutbox(ids: number[]): Promise<void>`
    - `outboxSize(): Promise<number>`

- [x] **Step 1: Install idb**

```bash
npm install idb
```

- [x] **Step 2: Write the failing tests**

Create `lib/station/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openStore, type CachedPerson } from "./store";
import type { MealWindow } from "@/lib/meals/types";

const person = (netid: string, over: Partial<CachedPerson> = {}): CachedPerson => ({
  netid,
  fullName: `Person ${netid}`,
  isMember: true,
  homeClub: "Cap & Gown",
  photoPath: `${netid}.webp`,
  ...over,
});

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

beforeEach(async () => {
  indexedDB.deleteDatabase("cap-station");
});

describe("the station store", () => {
  it("resolves a token to the person behind it", async () => {
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "CARD-1", netid: "aa1111" }],
      schedule: SCHEDULE,
      versions: { roster: 1, schedule: 1 },
    });

    expect((await store.resolveToken("CARD-1"))?.netid).toBe("aa1111");
  });

  it("returns null for a token it has never seen", async () => {
    const store = await openStore();
    await store.putBootstrap({
      people: [], credentials: [], schedule: [], versions: { roster: 1, schedule: 1 },
    });

    expect(await store.resolveToken("NOPE")).toBeNull();
  });

  it("resolves a token added after bootstrap", async () => {
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111")], credentials: [],
      schedule: SCHEDULE, versions: { roster: 1, schedule: 1 },
    });

    await store.addCredential("NEW-CARD", "aa1111");

    expect((await store.resolveToken("NEW-CARD"))?.fullName).toBe("Person aa1111");
  });

  it("resolves two different tokens to the same person", async () => {
    // A replacement card adds a credential rather than replacing one.
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "OLD", netid: "aa1111" }],
      schedule: SCHEDULE, versions: { roster: 1, schedule: 1 },
    });
    await store.addCredential("NEW", "aa1111");

    expect((await store.resolveToken("OLD"))?.netid).toBe("aa1111");
    expect((await store.resolveToken("NEW"))?.netid).toBe("aa1111");
  });

  it("survives being reopened, so a tablet reboot loses nothing", async () => {
    const first = await openStore();
    await first.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "CARD-1", netid: "aa1111" }],
      schedule: SCHEDULE, versions: { roster: 4, schedule: 2 },
    });

    const second = await openStore();
    expect((await second.resolveToken("CARD-1"))?.netid).toBe("aa1111");
    expect(await second.getVersions()).toEqual({ roster: 4, schedule: 2 });
  });

  it("replaces the roster on re-bootstrap rather than merging it", async () => {
    // A departed member must actually disappear from the picker.
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111"), person("bb2222")],
      credentials: [], schedule: SCHEDULE, versions: { roster: 1, schedule: 1 },
    });
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [], schedule: SCHEDULE, versions: { roster: 2, schedule: 1 },
    });

    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });

  it("lists members with no bound card first, for the picker", async () => {
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111"), person("bb2222"), person("cc3333")],
      credentials: [{ token: "CARD-B", netid: "bb2222" }],
      schedule: SCHEDULE, versions: { roster: 1, schedule: 1 },
    });

    const unbound = (await store.unboundMembers()).map((p) => p.netid);
    expect(unbound).toContain("aa1111");
    expect(unbound).toContain("cc3333");
    expect(unbound).not.toContain("bb2222");
  });

  it("excludes non-members from the member picker", async () => {
    const store = await openStore();
    await store.putBootstrap({
      people: [person("aa1111"), person("gg9999", { isMember: false, homeClub: "Cottage" })],
      credentials: [], schedule: SCHEDULE, versions: { roster: 1, schedule: 1 },
    });

    expect((await store.unboundMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });

  it("stores and returns a photo blob", async () => {
    const store = await openStore();
    const blob = new Blob(["fake-image-bytes"], { type: "image/webp" });

    await store.putPhoto("aa1111.webp", blob);

    expect(await store.hasPhoto("aa1111.webp")).toBe(true);
    expect(await (await store.getPhoto("aa1111.webp"))!.text()).toBe("fake-image-bytes");
  });

  it("reports a photo it does not have", async () => {
    const store = await openStore();
    expect(await store.hasPhoto("missing.webp")).toBe(false);
  });

  it("keeps photos across a re-bootstrap", async () => {
    // Re-bootstrap happens whenever the roster version moves. Dropping ~12MB
    // of headshots because a name was corrected would be a bad trade.
    const store = await openStore();
    await store.putPhoto("aa1111.webp", new Blob(["bytes"]));
    await store.putBootstrap({
      people: [person("aa1111")], credentials: [],
      schedule: SCHEDULE, versions: { roster: 9, schedule: 1 },
    });

    expect(await store.hasPhoto("aa1111.webp")).toBe(true);
  });

  it("queues outbox items in order and hands them back with ids", async () => {
    const store = await openStore();
    await store.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.enqueue({ kind: "binding", token: "CARD-9", netid: "aa1111" });

    const items = await store.peekOutbox();
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("swipe");
    expect(items[1].kind).toBe("binding");
    expect(items.every((i) => typeof i.id === "number")).toBe(true);
  });

  it("removes only the items that were acknowledged", async () => {
    const store = await openStore();
    await store.enqueue({ kind: "swipe", netid: "a", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.enqueue({ kind: "swipe", netid: "b", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });

    const [first] = await store.peekOutbox();
    await store.removeFromOutbox([first.id]);

    const left = await store.peekOutbox();
    expect(left).toHaveLength(1);
    expect(left[0].netid).toBe("b");
  });

  it("keeps the outbox across a reopen, so a reboot mid-rush loses no scans", async () => {
    const first = await openStore();
    await first.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });

    const second = await openStore();
    expect(await second.outboxSize()).toBe(1);
  });

  it("does not clear the outbox on re-bootstrap", async () => {
    const store = await openStore();
    await store.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.putBootstrap({
      people: [], credentials: [], schedule: [], versions: { roster: 2, schedule: 2 },
    });

    expect(await store.outboxSize()).toBe(1);
  });
});
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npm test lib/station/store`
Expected: FAIL — module `./store` not found.

- [x] **Step 4: Write the implementation**

Create `lib/station/store.ts`. Schema — database `cap-station`, version 1, five object stores:

| Store | Key | Holds |
|---|---|---|
| `meta` | out-of-line (`"versions"`, `"schedule"`) | small singletons |
| `people` | `netid` | the roster |
| `credentials` | `token` | `{ token, netid }` |
| `photos` | out-of-line (the photo path) | `Blob` |
| `outbox` | auto-increment `id` | queued work |

Requirements the tests pin down:

- `putBootstrap` **clears and replaces** `people`, `credentials`, and the `meta` entries in a single transaction — a departed member must vanish from the picker.
- `putBootstrap` **must not touch** `photos` or `outbox`. Re-bootstrap happens on any roster version bump; dropping 12 MB of headshots or a rush's worth of unsent scans would be a serious bug.
- `unboundMembers()` returns `isMember` people with no row in `credentials` pointing at them, and it is used only to order the picker — `allMembers()` backs the search that must always be available.
- `peekOutbox()` returns items in insertion order with their numeric `id` attached.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test lib/station/store`
Expected: PASS, 15 tests.

- [x] **Step 6: Commit**

```bash
git add lib/station package.json package-lock.json
git commit -m "feat: add the station's local IndexedDB store"
```

---

### Task 2: Bind and guest endpoints

Two API routes Plan 1 did not build. The prompt cannot resolve an unknown card without them.

**Files:**
- Create: `lib/directory/lookup.ts`
- Create: `lib/directory/lookup.test.ts`
- Create: `app/api/bind/route.ts`
- Create: `app/api/bind/route.test.ts`
- Create: `app/api/guests/route.ts`
- Create: `app/api/guests/route.test.ts`

**Interfaces:**
- Consumes: `authenticateDevice`, `serviceClient`, `envelope`, `bumpVersion`
- Produces:
  - `isValidNetid(netid: string): boolean`
  - `lookupNetid(netid: string): Promise<{ netid: string; fullName: string | null } | null>`
  - `POST /api/bind` accepting `{ token, netid }` → `{ data: { token, netid }, versions }`
  - `POST /api/guests` accepting `{ netid, homeClub, token? }` → `{ data: CachedPerson, versions }`

- [x] **Step 1: Write the directory stub and its tests**

Open question **O2** — whether TigerBook or Princeton LDAP is reachable from a serverless function — is not resolved. This module is the seam that keeps it from blocking anything.

Create `lib/directory/lookup.ts`:

```ts
export type DirectoryPerson = { netid: string; fullName: string | null };

/**
 * Princeton netIDs are lowercase alphanumeric. The exact rule is not
 * documented publicly, so this is deliberately permissive — it exists to
 * reject obvious typos and pasted junk, not to be an authority.
 */
const NETID_SHAPE = /^[a-z][a-z0-9]{1,15}$/;

export function isValidNetid(netid: string): boolean {
  return NETID_SHAPE.test(netid.trim().toLowerCase());
}

/**
 * Resolve a netID to a person.
 *
 * STUB — open question O2. TigerBook and Princeton LDAP are both candidates
 * and neither has been shown to work from a Vercel function; LDAP in
 * particular may require the campus network.
 *
 * Until that closes, this validates the shape and returns a null name. Every
 * guest flow works; guests simply show as their netID until the real lookup
 * lands. Swapping this module is the whole change.
 */
export async function lookupNetid(netid: string): Promise<DirectoryPerson | null> {
  const normalised = netid.trim().toLowerCase();
  if (!isValidNetid(normalised)) return null;
  return { netid: normalised, fullName: null };
}
```

Create `lib/directory/lookup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidNetid, lookupNetid } from "./lookup";

describe("isValidNetid", () => {
  it.each(["ab1234", "ab12", "zz9"])("accepts %s", (n) => {
    expect(isValidNetid(n)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["a", "too short"],
    ["4888hf", "starts with a digit"],
    ["hf 4888", "contains a space"],
    ["hf-4888", "contains punctuation"],
    ["ab1234@princeton.edu", "an email, not a netID"],
    ["averyveryverylongnetid", "too long"],
  ])("rejects %s (%s)", (n) => {
    expect(isValidNetid(n)).toBe(false);
  });

  it("accepts a netID typed in capitals", () => {
    expect(isValidNetid("AB1234")).toBe(true);
  });
});

describe("lookupNetid", () => {
  it("normalises case and whitespace", async () => {
    expect(await lookupNetid("  AB1234 ")).toEqual({ netid: "ab1234", fullName: null });
  });

  it("returns null for something that is not a netID", async () => {
    expect(await lookupNetid("not a netid")).toBeNull();
  });

  it("returns a null name while the real directory is unresolved (O2)", async () => {
    // When O2 closes, this test changes and the guest ledger gains names.
    // Until then it documents that a null name is expected, not a bug.
    expect((await lookupNetid("ab1234"))!.fullName).toBeNull();
  });
});
```

- [x] **Step 2: Run the directory tests**

Run: `npm test lib/directory`
Expected: PASS, 12 tests.

- [x] **Step 3: Write the bind endpoint tests**

Create `app/api/bind/route.test.ts`. It must prove:

| Test | Assertion |
|---|---|
| refuses an unenrolled device | 401 |
| binds a card to a member | 200, row in `credentials` |
| binds a **second** card to the same member | both tokens resolve to that netID |
| refuses a netID not in `people` | 404, no row written |
| is idempotent — same bind twice | 200 both times, one row |
| refuses to rebind a token already pointing elsewhere | 409, **existing binding unchanged** |
| bumps the roster version | tablets learn about the new credential on next sync |
| returns 400 on a missing field | 400 |

The 409 case is the one that matters. Spec section 8 says the server keeps its existing binding when an offline tablet disagrees. **The test must assert the original row still points where it did**, not merely that the response was an error.

- [x] **Step 4: Write the bind endpoint**

Create `app/api/bind/route.ts`. Authenticate, validate, confirm the person exists, then insert into `credentials`. On unique violation (`23505`), read the existing row: if it already points at the same netID, return 200 — re-sending a queued binding must be free, exactly as with swipes. If it points elsewhere, return 409 and change nothing. Call `bumpVersion("roster")` on a real insert.

- [x] **Step 5: Write the guests endpoint tests**

Create `app/api/guests/route.test.ts`. It must prove:

| Test | Assertion |
|---|---|
| refuses an unenrolled device | 401 |
| creates a guest with `is_member` false | row in `people`, `is_member` false |
| binds the card in the same call | token resolves to the guest |
| rejects a malformed netID | 400, nothing written |
| rejects an unknown club | 400 (foreign key on `clubs`) |
| accepts `'None'` as a club | 200 — records the absence of a club |
| returns the existing person if the netID is already known | 200, does **not** overwrite `is_member` |
| a returning guest keeps their history | second call leaves one `people` row |
| bumps the roster version | |

The "already known" case is the important one. A **departed member** eating as a guest already exists in `people`. Creating them must not clobber their record — and a **current member** whose card was mis-scanned into the guest flow must not be demoted to guest.

- [x] **Step 6: Write the guests endpoint**

Create `app/api/guests/route.ts`. Authenticate, `lookupNetid`, reject on null. If the person exists, return them untouched and bind the token if one was supplied. Otherwise insert with `is_member: false`, the supplied `home_club`, and `full_name` from the directory or the netID itself as a fallback. Bind the token. Bump the roster version.

- [x] **Step 7: Verify and commit**

```bash
set -o pipefail
npm test && npm run build
git add lib/directory app/api/bind app/api/guests
git commit -m "feat: add bind and guest endpoints with a stubbed directory lookup"
```

---

### Task 3: The API client

One module owns every network call, its timeout budget, and its retries. Nothing else calls `fetch`.

**Files:**
- Create: `lib/station/api.ts`
- Create: `lib/station/api.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; takes the device token as an argument
- Produces:
  - `type ApiResult<T> = { ok: true; data: T; versions: Versions } | { ok: false; status: number | null }`
  - `bootstrap(token)`, `resolve(token, card)`, `bind(token, card, netid)`, `createGuest(token, netid, homeClub, card)`, `sync(token, items)`
  - `status: null` means the network never answered. A number means the server answered and refused.

- [x] **Step 1: Write the failing tests**

Create `lib/station/api.test.ts`. Mock `globalThis.fetch`. It must prove:

| Test | Why it matters |
|---|---|
| sends the device token as a Bearer header | every station endpoint requires it |
| unwraps `{ data, versions }` into the result | callers never see the envelope |
| a 404 from resolve returns `ok: false, status: 404` | 404 is "unknown card", not a failure — the caller branches on it |
| a 401 returns `status: 401` without retrying | retrying a rejected token is pointless |
| **retries twice on a network error, then gives up** | spec A6 |
| **the whole attempt finishes within the 3-second budget** | a student is standing there |
| `status` is `null` when the network never answered | distinguishes "refused" from "unreachable" |
| a slow response is aborted rather than awaited forever | the failure mode that would freeze a lane |

Use fake timers for the budget tests so they run instantly.

- [x] **Step 2: Run to verify failure, then implement**

Create `lib/station/api.ts`. One private `request()` using `AbortController` with a 1-second per-attempt timeout and at most three attempts. Retry only on network errors and 5xx — never on 4xx, which are answers, not failures.

- [x] **Step 3: Verify and commit**

```bash
set -o pipefail && npm test lib/station/api
git add lib/station/api.ts lib/station/api.test.ts
git commit -m "feat: add the station API client with a 3-second failure budget"
```

---

### Task 4: The outbox

**Files:**
- Create: `lib/station/outbox.ts`
- Create: `lib/station/outbox.test.ts`

**Interfaces:**
- Consumes: `StationStore`, `lib/station/api`
- Produces: `flushOutbox(deps): Promise<{ sent: number; remaining: number }>` and `startOutboxLoop(deps, intervalMs?): () => void`

- [x] **Step 1: Write the failing tests**

Create `lib/station/outbox.test.ts`. It must prove:

| Test | Why it matters |
|---|---|
| sends queued swipes and removes them once acknowledged | the basic contract |
| **leaves items queued when the server is unreachable** | nothing is lost by an outage |
| **re-sending after a partial failure produces no duplicates** | the whole idempotency story |
| sends bindings as well as swipes | offline member binds reach the server |
| an empty outbox performs no network call at all | the loop must be free when idle |
| a 409 on a binding drops it rather than retrying forever | the server won that conflict; retrying is a poison-pill loop |
| the loop stops when its returned function is called | no leaked timers on unmount |
| **two concurrent flushes do not send the same item twice** | the loop and a post-scan flush can overlap |

That last one is a real hazard: a scan triggers an immediate flush while the interval flush is mid-flight. Guard with a module-level in-flight flag.

- [x] **Step 2: Implement, verify, commit**

```bash
set -o pipefail && npm test lib/station/outbox
git add lib/station/outbox.ts lib/station/outbox.test.ts
git commit -m "feat: add the outbox with a concurrency guard"
```

---

### Task 5: Scan resolution — the four cases

The heart of the app, and deliberately free of React so it can be tested directly.

**Files:**
- Create: `lib/station/resolve.ts`
- Create: `lib/station/resolve.test.ts`

**Interfaces:**
- Consumes: `StationStore`, `lib/station/api`, `deriveMeal`
- Produces:
  - `type ScanOutcome = { kind: "no-meal" } | { kind: "checked-in"; person: CachedPerson; mealPeriod: string } | { kind: "prompt"; card: string } | { kind: "failed" }`
  - `resolveScan(card: string, deps: ResolveDeps): Promise<ScanOutcome>`

- [x] **Step 1: Write the failing tests**

Create `lib/station/resolve.test.ts`. Dependencies are injected, so every case is reachable without a network. It must prove:

| # | Case | Assertion |
|---|---|---|
| — | no meal running | `no-meal`, **nothing queued**, **no network call** |
| 1 | token in cache | `checked-in`, swipe queued, **`api.resolve` never called** |
| 1 | cache hit is fast | resolves with the network mocked to hang forever |
| 2 | not cached, server knows | `checked-in`, credential cached, swipe queued |
| 2 | second scan of that card | now case 1 — no second network call |
| 3 | not cached, server returns 404 | `prompt` |
| 4 | not cached, server unreachable | `prompt` — the member path works offline |
| — | repeat scan in the same meal | `checked-in` again, and **a second swipe is queued** |
| — | the queued swipe carries a netID, never a card token | no ordering dependency on bindings |
| — | `scannedAt` is the moment of the scan | the rush histogram depends on it |

The repeat-scan case is worth stating plainly: the tablet does **not** deduplicate. It queues both. The database's primary key collapses them. Duplicating that logic on the tablet would mean two places to be wrong.

- [x] **Step 2: Implement, verify, commit**

```bash
set -o pipefail && npm test lib/station/resolve
git add lib/station/resolve.ts lib/station/resolve.test.ts
git commit -m "feat: add four-case scan resolution"
```

---

### Task 6: Completing the prompt — binding and guest creation

**Files:**
- Create: `lib/station/prompt.ts`
- Create: `lib/station/prompt.test.ts`

**Interfaces:**
- Produces:
  - `bindMember(card, netid, deps): Promise<ScanOutcome>` — works fully offline
  - `createGuest(card, netid, homeClub, deps): Promise<ScanOutcome>` — needs the server, abandons on failure

- [x] **Step 1: Write the failing tests**

It must prove:

| Test | Why |
|---|---|
| binding a member online caches the credential and queues the swipe | |
| **binding a member offline still checks them in** | spec case 4, the member path |
| an offline binding is queued and reaches the server later | |
| creating a guest online checks them in and caches them | |
| **creating a guest offline returns `failed` and queues nothing** | spec A6 — the one lossy path, on purpose |
| a guest that fails is not left half-created in the local cache | |

The offline-guest test is the one that documents an intentional data loss. Its name should say so, or a future reader will "fix" it.

- [x] **Step 2: Implement, verify, commit**

```bash
set -o pipefail && npm test lib/station/prompt
git add lib/station/prompt.ts lib/station/prompt.test.ts
git commit -m "feat: add member binding and guest creation from the prompt"
```

---

### Task 7: Bootstrap, photo caching, and version refresh

**Files:**
- Create: `lib/station/bootstrap.ts`
- Create: `lib/station/bootstrap.test.ts`

**Interfaces:**
- Produces:
  - `warmCache(deps): Promise<{ people: number; photos: number }>`
  - `refreshIfStale(deps, seen: Versions): Promise<boolean>`
  - `photoUrl(store, photoPath): Promise<string | null>` — an object URL, or null for the initials placeholder

- [x] **Step 1: Write the failing tests**

It must prove:

| Test | Why it matters |
|---|---|
| a first launch fetches bootstrap and stores it | |
| **it downloads only photos not already cached** | the difference between 12 MB and a few kilobytes on every launch |
| a failed photo download does not abort the rest | one 404 must not cost the other 299 headshots |
| **a missing photo yields null, not an error** | headshots arrive late (O5); names and counts must work regardless |
| `refreshIfStale` does nothing when versions match | |
| `refreshIfStale` re-bootstraps when the roster version moves | |
| `refreshIfStale` re-bootstraps when the schedule version moves | |
| **a refresh preserves cached photos and the outbox** | already asserted in the store; asserted again through this path |
| a failed refresh leaves the existing cache intact | a bad network must not empty a working tablet |

- [x] **Step 2: Implement, verify, commit**

Photos download with limited concurrency — six at a time — so three tablets warming at once over club Wi-Fi do not open 300 parallel connections.

```bash
set -o pipefail && npm test lib/station/bootstrap
git add lib/station/bootstrap.ts lib/station/bootstrap.test.ts
git commit -m "feat: add cache warming, incremental photo download, and version refresh"
```

---

### Task 8: The station screens

Every piece of logic is already tested. This task is rendering.

**Files:**
- Create: `app/station/StationScreen.tsx`
- Create: `app/station/EnrollScreen.tsx`
- Create: `app/station/MemberPicker.tsx`
- Create: `app/station/GuestForm.tsx`
- Create: `app/station/Avatar.tsx`
- Create: `app/station/StationScreen.test.tsx`
- Create: `app/station/MemberPicker.test.tsx`
- Modify: `app/station/page.tsx` — becomes a thin shell
- Modify: `lib/station/session.ts` (create) — device token get/set/enroll

**Interfaces:**
- Consumes: everything from Tasks 1–7

- [x] **Step 1: Screen states**

| State | Shows | Leaves when |
|---|---|---|
| `enrolling` | code entry | a device token exists |
| `warming` | "Preparing…" with progress | cache warmed |
| `idle` | "Scan your card", current meal name, a small unsynced count | a scan arrives |
| `checked-in` | large photo, name, "Checked in for Lunch" | 3 s, or the next scan |
| `no-meal` | "No meal is running right now" | 3 s, or the next scan |
| `prompt` | Member / Guest choice | resolved or cancelled |
| `failed` | "Could not reach the server — not counted" | 3 s, or the next scan |

- [x] **Step 2: Avatar**

`Avatar.tsx` renders the cached photo, or **initials in a circle** when there is none. Headshots are open question O5 and may not arrive before go-live; the placeholder must look deliberate rather than broken. Revoke object URLs on unmount.

- [x] **Step 3: Member picker**

Unbound members first, then a search across **all** members. A member who already has a card and shows up with a replacement must be findable — otherwise they are stuck as a guest. Search matches name and netID, case-insensitively.

Tests must prove: unbound listed first; search finds an already-bound member; search is case-insensitive; selecting fires the callback with the netID.

- [x] **Step 4: Guest form**

netID field plus a club dropdown from the twelve seeded clubs. Client-side `isValidNetid` before submitting, so an obvious typo never reaches the server.

- [x] **Step 5: Screen tests**

`StationScreen.test.tsx` must prove:

- a scan burst produces the checked-in state with the person's name
- the checked-in state **clears after 3 seconds** (fake timers)
- **a second scan replaces the first person's face immediately** — the privacy reason the timer exists at all
- the failed state renders an explicit message, not a blank screen
- the idle screen shows the current meal name
- the idle screen shows an unsynced count when the outbox is not empty

- [x] **Step 6: Rewrite `page.tsx` as a shell**

It owns the burst listener, the store handle, and the outbox loop, and renders whichever screen the state calls for. All decisions live in `lib/station/`.

- [x] **Step 7: Verify and commit**

```bash
set -o pipefail
npm test && npm run build
git add app/station lib/station/session.ts
git commit -m "feat: replace the walking skeleton with the real station screens"
```

---

### Task 9: The four offline end-to-end tests

The design's core claims, verified in a real browser — the only place `setOffline` and real IndexedDB exist together.

**Files:**
- Create: `e2e/offline.spec.ts`
- Delete: `e2e/skeleton.spec.ts` (superseded)

- [x] **Step 1: Write the four tests**

```
1. A known card scans with the network off.
   Warm the cache online. context.setOffline(true). Scan.
   Assert: checked in, name on screen, NO network request attempted.

2. Go offline mid-service, scan several people, come back online.
   Assert: every scan succeeds on screen while offline; after
   setOffline(false), all swipes appear in Postgres with nobody
   touching anything.

3. An unknown card offline, member path.
   Assert: the prompt appears from the cached roster, the operator picks
   a name, the person is checked in, and both the binding and the swipe
   reach the server once the network returns.

4. Bootstrap caches photos in IndexedDB and survives a reload.
   Assert: after a reload with the network off, the photo still renders
   and the roster still resolves.
```

Test 2 is the failure drill from the spec, run automatically. It is the claim the entire architecture exists to support, and August 30 gives you one chance to check it by hand.

- [x] **Step 2: Fixture rules**

Insert meal windows at **03:00–04:00**, clear of every service hour, and derive the weekday with `Intl` in `America/New_York` — never `getDay()`. Both rules exist because both mistakes have already been made in this repo.

- [x] **Step 3: Verify and commit**

```bash
set -o pipefail
npm test && npm run test:e2e && npm run build
git add e2e
git rm e2e/skeleton.spec.ts
git commit -m "test: verify the offline design in a real browser"
```

---

## What this plan deliberately does not build

Plan 3 territory. Listed so their absence reads as a decision.

- Every dashboard feature: login, charts, live count, export, roster upload, photo upload
- The admin screen that generates enrolment codes — until then, codes are created from a script and the README documents it
- The real directory lookup (**O2**) — the stub keeps every guest flow working, with guests showing as their netID
- Schedule exceptions for breaks — deliberately deferred to late October

## Open questions this plan closes or narrows

| ID | Effect |
|---|---|
| **O1** | Narrowed. The magstripe reader is ordered. When it arrives, swipe a card into a plain text editor, send the literal characters, and one parsing module is written. `MIN_TOKEN_LENGTH`, `MAX_BURST_MS`, and `GAP_MS` are tuned then. Magstripe output often carries sentinels (`;…=…?`) and some readers emit one Enter per track, which would fire two scans per swipe — the parser handles both. |
| **O2** | Isolated behind `lib/directory/lookup.ts`. Not blocking. |
| **O5** | Isolated behind the initials placeholder. Not blocking. |


---

## Post-execution finding: the app shell is not cached

**Found 2026-08-17, while writing the offline end-to-end tests. Not fixed.**

IndexedDB holds everything a tablet needs to serve a meal. But the app shell —
the HTML and JavaScript — is still fetched over the network. Reload a tablet
during a Wi-Fi outage and the browser cannot load the page at all
(`ERR_INTERNET_DISCONNECTED`), so the warm cache is unreachable.

The spec's architecture diagram calls the station app a PWA. The service
worker that would make that true was never planned, in this plan or in plan 1.

`e2e/offline.spec.ts` carries a `test.fixme` named for this, so it stays
visible in the suite rather than living only in a document.

**Impact:** a tablet that reboots or is refreshed during an outage is dead
until the network returns. Everything else offline works.

**Fix:** a service worker caching the shell, plus a manifest. Small — a few
hours — but it is genuinely new scope and belongs to its own plan.
