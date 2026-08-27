# Card Identity and the First Swipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first swipe of an unbound card confirm one pre-filled name
instead of searching a list of 196.

**Architecture:** The magnetic stripe carries the holder's name. The station
uses it to produce *candidates* — unbound people whose name corresponds — and
a human always picks, with a netID shown beside each. One token per card, one
card per person, enforced by a unique index.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase/Postgres, IndexedDB
via `idb`, Vitest + Testing Library, Playwright.

**Spec:** `docs/specs/2026-08-26-card-identity-and-first-swipe.md`

## Global Constraints

- **The token is track 1's 15-digit number.** No track 1 → track 2 minus its
  last four digits. One token per card, everywhere.
- **A name narrows; it never identifies** (spec A8). No path may check anyone
  in on a name alone.
- **Every candidate tile shows a netID.** No headshots exist — `photo_path` is
  null for all 196 — so the netID is what makes the screen correct.
- **Run tests with `set -o pipefail`** if piping to `grep` or `tail`. A red
  commit has gone out this way.
- **Commit messages use a heredoc with a quoted delimiter.** Backticks inside a
  double-quoted message are executed by the shell.
- **Never commit a roster or a photograph.** `*.csv` is gitignored.
- Vitest runs serially (`fileParallelism: false`) against one local Postgres
  holding the real 196-member roster. Any test asserting on global state must
  park real rows and restore them.
- Test command: `npm test`. Single file: `npx vitest run <path>`.

---

### Task 1: The name matcher

A pure module with no I/O. Nothing is wired to it in this task, so the system
is unchanged and cannot regress.

**Files:**
- Create: `lib/scan/name-match.ts`
- Test: `lib/scan/name-match.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `nameChunks(name: string): Set<string>[]`
  - `namesMatch(cardName: string[], fullName: string): boolean`
  - `nameCandidates<T extends { fullName: string }>(cardName: string[], people: T[]): T[]`
  - `MIN_CORRESPONDING: number` (value `2`)

- [ ] **Step 1: Write the failing test**

Create `lib/scan/name-match.test.ts`. Every name below is real, from the
club's own roster.

```ts
import { describe, it, expect } from "vitest";
import { nameCandidates, namesMatch, nameChunks } from "./name-match";

/**
 * Synthetic people, NOT the club's roster.
 *
 * Every shape here is one the real roster actually contains - two identical
 * full names, a surname shared four ways, an apostrophe, an accent, two
 * hyphenated surnames, a four-word double surname and a middle name - but the
 * names and netIDs are invented. A netID is an email address, and git history
 * is permanent.
 */
const ROSTER = [
  { netid: "aa1001", fullName: "Hamid Farrow" },
  { netid: "rh1000", fullName: "Robin Hale" },
  { netid: "rh1001", fullName: "Robin Hale" },
  { netid: "aw2001", fullName: "Alice Ward" },
  { netid: "bw2002", fullName: "Brian Ward" },
  { netid: "cw2003", fullName: "Cara Ward" },
  { netid: "dw2004", fullName: "Dana Ward" },
  { netid: "vd3001", fullName: "Vincent D'Amico" },
  { netid: "rd3002", fullName: "Renée Dubois" },
  { netid: "lh4001", fullName: "Lily Harper-Stone" },
  { netid: "la4002", fullName: "Leila Ashworth-Vance" },
  { netid: "mg5001", fullName: "Manuel Garcia San Pablo" },
  { netid: "ew6001", fullName: "Emma May Whitfield" },
];

const netids = (parts: string[]) => nameCandidates(parts, ROSTER).map((p) => p.netid);

describe("nameCandidates", () => {
  it("finds the one member a real card names", () => {
    expect(netids(["HAMID", "FARROW"])).toEqual(["aa1001"]);
  });

  it("RETURNS BOTH HEIDI LEES, because a name is not an identity", () => {
    // The case the whole design exists for. Two real members share this
    // name, so the matcher must never pick one of them itself.
    expect(netids(["ROBIN", "HALE"])).toEqual(["rh1000", "rh1001"]);
  });

  it("KEEPS THE FOUR KIMS APART on one shared chunk", () => {
    // A surname alone must never be a match, or a rush turns into a
    // four-way pick every time somebody named Ward swipes.
    expect(netids(["ALICE", "WARD"])).toEqual(["aw2001"]);
    expect(netids(["BRIAN", "WARD"])).toEqual(["bw2002"]);
  });

  it("does not care whether the card sends FIRST/LAST or LAST/FIRST", () => {
    // We hold exactly one real card and cannot know which order it uses.
    expect(netids(["FARROW", "HAMID"])).toEqual(["aa1001"]);
  });

  it("REFUSES A RELATIVE who shares a hyphenated surname", () => {
    // A flat bag of words let the surname supply two shared words on its
    // own, so this matched Lily Harper-Stone. Chunks require the first name to agree.
    expect(netids(["ANNA", "HARPER-STONE"])).toEqual([]);
    expect(netids(["LILY", "HARPER-STONE"])).toEqual(["lh4001"]);
  });

  it("matches a hyphenated surname written without its hyphen", () => {
    expect(netids(["LILY", "HARPERSTONE"])).toEqual(["lh4001"]);
    expect(netids(["LEILA", "ASHWORTHVANCE"])).toEqual(["la4002"]);
  });

  it("matches through an apostrophe and through an accent", () => {
    expect(netids(["VINCENT", "DAMICO"])).toEqual(["vd3001"]);
    expect(netids(["VINCENT", "D'AMICO"])).toEqual(["vd3001"]);
    expect(netids(["RENEE", "DUBOIS"])).toEqual(["rd3002"]);
  });

  it("tolerates a middle name the card omits", () => {
    expect(netids(["EMMA", "WHITFIELD"])).toEqual(["ew6001"]);
  });

  it("tolerates a middle name the card adds and the roster lacks", () => {
    // The direction we are blind in: nobody has seen a card carrying one.
    expect(netids(["HAMID", "ALI", "FARROW"])).toEqual(["aa1001"]);
  });

  it("handles a four-word double surname", () => {
    expect(netids(["MANUEL", "GARCIA"])).toEqual(["mg5001"]);
    expect(netids(["MANUEL", "SAN", "PABLO"])).toEqual(["mg5001"]);
  });

  it("NEVER MATCHES ON A SINGLE CHUNK", () => {
    // A truncated stripe must fall through to the guest form, not bind
    // somebody at random.
    expect(netids(["WARD"])).toEqual([]);
    expect(netids(["FARROW"])).toEqual([]);
    expect(netids([])).toEqual([]);
  });

  it("ignores one-letter chunks, which are middle initials", () => {
    expect(netids(["EMMA", "M", "WHITFIELD"])).toEqual(["ew6001"]);
  });

  it("returns nothing for a name nobody has", () => {
    expect(netids(["JOHN", "SMITH"])).toEqual([]);
  });
});

describe("namesMatch", () => {
  it("agrees with nameCandidates for a single person", () => {
    expect(namesMatch(["HAMID", "FARROW"], "Hamid Farrow")).toBe(true);
    expect(namesMatch(["HAMID", "FARROW"], "Robin Hale")).toBe(false);
  });
});

describe("nameChunks", () => {
  it("gives a hyphenated chunk both its joined and split forms", () => {
    const [, surname] = nameChunks("Lily Harper-Stone");
    expect(surname).toEqual(new Set(["HARPERSTONE", "HARPER", "STONE"]));
  });

  it("drops empty chunks from doubled spaces", () => {
    expect(nameChunks("Robin   Hale")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/scan/name-match.test.ts
```

Expected: FAIL — `Failed to resolve import "./name-match"`.

- [ ] **Step 3: Write the implementation**

Create `lib/scan/name-match.ts`:

```ts
/**
 * Decide which people a card's printed name could refer to.
 *
 * A name never identifies anybody — spec A8. This produces candidates for a
 * human to choose between, and every caller shows a netID beside each one so
 * the choice can be checked. Measured against the real 196-member roster,
 * 194 people produce exactly one candidate and two produce two: the club has
 * two members share a full name.
 *
 * The comparison is chunk to chunk rather than word to word. A flat bag of
 * words lets one hyphenated surname supply two shared words by itself, which
 * let one hyphenated surname match a relative who shares it. Two relatives
 * at the same club is not a hypothetical.
 */

/** How many chunks must correspond before two names are considered a match. */
export const MIN_CORRESPONDING = 2;

/**
 * Every form one chunk of a name might legitimately take.
 *
 * Both the joined and the split forms of a hyphenated chunk are kept, because
 * we do not know whether a stripe preserves the hyphen and only one real card
 * has ever been read.
 */
function chunkForms(chunk: string): Set<string> {
  const cleaned = chunk
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks: Renée -> Renee
    .replace(/['\u2019.]/g, ""); // straight and curly apostrophes: O'Brien -> OBrien

  const forms = new Set<string>();

  const joined = cleaned.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (joined.length > 1) forms.add(joined);

  for (const part of cleaned.split(/[^A-Za-z]+/)) {
    // One letter is a middle initial, which carries no matching power.
    if (part.length > 1) forms.add(part.toUpperCase());
  }

  return forms;
}

/** A name as a list of chunks, each the set of forms it might take. */
export function nameChunks(name: string): Set<string>[] {
  return name
    .trim()
    .split(/\s+/)
    .map(chunkForms)
    .filter((forms) => forms.size > 0);
}

/**
 * How many card chunks correspond to a *distinct* roster chunk.
 *
 * Claiming each roster chunk at most once is what stops a single surname
 * satisfying the threshold on its own.
 */
function corresponding(card: Set<string>[], roster: Set<string>[]): number {
  const claimed = new Set<number>();
  let count = 0;

  for (const chunk of card) {
    for (let i = 0; i < roster.length; i++) {
      if (claimed.has(i)) continue;
      let shares = false;
      for (const form of chunk) {
        if (roster[i].has(form)) {
          shares = true;
          break;
        }
      }
      if (shares) {
        claimed.add(i);
        count += 1;
        break;
      }
    }
  }

  return count;
}

/** True when the card's name and a person's name correspond well enough. */
export function namesMatch(cardName: string[], fullName: string): boolean {
  const card = nameChunks(cardName.join(" "));
  if (card.length < MIN_CORRESPONDING) return false;
  return corresponding(card, nameChunks(fullName)) >= MIN_CORRESPONDING;
}

/**
 * Everyone the card's name could refer to.
 *
 * Order follows the list given, so a caller that passes people in a stable
 * order gets a stable screen.
 */
export function nameCandidates<T extends { fullName: string }>(
  cardName: string[],
  people: T[],
): T[] {
  const card = nameChunks(cardName.join(" "));
  if (card.length < MIN_CORRESPONDING) return [];
  return people.filter(
    (person) => corresponding(card, nameChunks(person.fullName)) >= MIN_CORRESPONDING,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run lib/scan/name-match.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Verify nothing else broke, then commit**

```bash
set -o pipefail; npm test 2>&1 | tail -20
```

```bash
git add lib/scan/name-match.ts lib/scan/name-match.test.ts
git commit -F- <<'MSG'
feat: work out who a card's printed name could mean

The stripe carries the holder's name, which turns the first swipe from a
search over 196 names into confirming one. The name can never be the identity
- the club has two members with one full name and eight colliding surnames - so
this produces candidates and a human always picks.

Compares chunk to chunk, not word to word. A flat bag of words let one
hyphenated surname supply two shared words on its own, so ANNA/HALBERT-
a hyphenated surname matched a relative who shares it. Claiming each chunk once
requires the first name to agree too.

Measured against the real roster before choosing the rule: 194 of 196 give
exactly one candidate, 2 give two, no self-misses, holding across three
guesses at what the card sends.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: One person, one card

Database constraint plus the two routes that must refuse a second card. This
is server-side only — no client type changes — so the station keeps working
throughout.

**Files:**
- Create: `supabase/migrations/0007_one_card_per_person.sql`
- Modify: `app/api/bind/route.ts`
- Modify: `app/api/guests/route.ts`
- Test: `app/api/bind/route.test.ts`, `app/api/guests/route.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: both routes answer **409** with body
  `{ error: "person already has a card", boundTo: <netid> }` when the netID
  already has a credential.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_one_card_per_person.sql`:

```sql
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
-- roster, refreshed at bootstrap. Only one insert can win against this index,
-- so the loser fails loudly at sync instead of quietly adding a second card.
--
-- Safe to apply: `credentials` held 0 rows locally and 0 in production when
-- this was written, verified before the migration was committed.
create unique index credentials_one_per_person on credentials (netid);

comment on table credentials is
  'Card tokens, ONE per person. The token is track 1''s 15-digit base number; '
  'the four-digit track 2 suffix is assumed to be a card issue number and is '
  'not stored. See docs/specs/2026-08-26-card-identity-and-first-swipe.md.';
```

- [ ] **Step 2: Apply it and confirm the constraint bites**

```bash
npx supabase db reset
```

Expected: reset completes with `0007_one_card_per_person.sql` applied.

```bash
docker exec supabase_db_cap_meal_scanner psql -U postgres -d postgres -c \
  "insert into credentials (token, netid)
   select 'T1', netid from people limit 1;
   insert into credentials (token, netid)
   select 'T2', netid from people limit 1;"
```

Expected: `ERROR: duplicate key value violates unique constraint "credentials_one_per_person"`.

Clean up:

```bash
docker exec supabase_db_cap_meal_scanner psql -U postgres -d postgres -c \
  "delete from credentials where token in ('T1','T2');"
```

- [ ] **Step 3: Write the failing route tests**

Append to `app/api/bind/route.test.ts`:

```ts
it("REFUSES A SECOND CARD FOR A PERSON WHO ALREADY HAS ONE", async () => {
  // Spec section 8. A member with a second card is an officer's problem,
  // not another row - and this is what makes the two-lane race lose loudly.
  await POST(bindRequest(TOKENS[0], "bind0001"));

  const res = await POST(bindRequest("BIND-CARD-OTHER", "bind0001"));

  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/already has a card/i);
});

it("still treats an identical re-send as success", async () => {
  // The outbox re-sends a batch it could not confirm. That must stay free.
  await POST(bindRequest(TOKENS[0], "bind0001"));
  const res = await POST(bindRequest(TOKENS[0], "bind0001"));

  expect(res.status).toBe(200);
});
```

Add a `bindRequest` helper near the top of that file if one does not exist:

```ts
const bindRequest = (token: string, netid: string) =>
  new Request("http://test/api/bind", {
    method: "POST",
    headers: { authorization: `Bearer ${token_}`, "content-type": "application/json" },
    body: JSON.stringify({ token, netid }),
  });
```

Read the file first and reuse its existing request helper and device-token
variable name rather than introducing a second one.

Also extend the `beforeEach` cleanup and `afterAll` cleanup to include
`"BIND-CARD-OTHER"` so the new token never leaks between runs.

- [ ] **Step 4: Run to verify it fails**

```bash
npx vitest run app/api/bind/route.test.ts
```

Expected: FAIL — the second bind currently returns 200, not 409.

- [ ] **Step 5: Enforce it in `/api/bind`**

In `app/api/bind/route.ts`, after the `person` existence check and before the
token-clash check, add:

```ts
  // Spec section 8: one person, one card. The unique index enforces this
  // too, but answering here gives the tablet a 409 it can explain rather
  // than a 500 from a constraint violation.
  const { data: heldByPerson } = await db
    .from("credentials")
    .select("token")
    .eq("netid", netid)
    .maybeSingle();

  if (heldByPerson && heldByPerson.token !== token) {
    return NextResponse.json(
      { error: "person already has a card", boundTo: netid },
      { status: 409 },
    );
  }
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run app/api/bind/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Do the same for `/api/guests`**

Write the failing test in `app/api/guests/route.test.ts`:

```ts
it("REFUSES when the typed netID already has a card", async () => {
  // The one place the officer message appears. Somebody tapped "No, I'm a
  // guest", typed a netID, and that person is already bound.
  await db.from("credentials").insert({ token: "GUEST-EXISTING", netid: "guest001" });

  const res = await POST(guestRequest("guest001", "Cannon", "GUEST-NEW-CARD"));

  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/already has a card/i);
});

it("CHECKS A MEMBER IN AS A MEMBER when their netID is typed at the guest form", async () => {
  // Case 8: the escape hatch for a card whose printed name does not match
  // the roster. This must never demote them to a guest.
  const res = await POST(guestRequest("bindmember01", "Cap & Gown", "GUEST-MEMBER-CARD"));

  expect(res.status).toBe(200);
  const { data } = await res.json();
  expect(data.isMember).toBe(true);
  expect(data.fullName).toBe("Bind Member");
});
```

Seed `bindmember01` as a member in that file's `beforeAll`, and delete both
new tokens plus that person in `afterAll`.

Then add the same guard to `app/api/guests/route.ts`, immediately before the
`if (token)` insert block:

```ts
  if (token) {
    const { data: heldByPerson } = await db
      .from("credentials")
      .select("token")
      .eq("netid", netid)
      .maybeSingle();

    if (heldByPerson && heldByPerson.token !== token) {
      return NextResponse.json(
        { error: "person already has a card", boundTo: netid },
        { status: 409 },
      );
    }
  }
```

- [ ] **Step 8: Run the whole suite and commit**

```bash
set -o pipefail; npm test 2>&1 | tail -20
```

```bash
git add supabase/migrations/0007_one_card_per_person.sql app/api/bind app/api/guests
git commit -F- <<'MSG'
feat: one person, one card, enforced by the database

A member who turns up with a second card is now refused rather than given
another row. Both /api/bind and /api/guests answer 409, and a unique index on
credentials.netid makes it true underneath them.

The index is the part that matters. Each tablet decides who is unbound from
its own cached roster, refreshed only at bootstrap, so two lanes can both
believe the same person has no card - which is exactly what happens if both
members who share a full name swipe at once. Application checks cannot see it.
The index can, and the loser fails loudly at sync.

Verified 0 credential rows locally and 0 in production before applying, so the
index took with nothing to reconcile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: One token, end to end

The card parser stops returning two numbers. This ripples through the type
boundary, so parser, transport, store, outbox and both routes move together —
splitting it would leave the tree uncompilable.

**Files:**
- Modify: `lib/scan/card.ts`, `lib/scan/card.test.ts`
- Modify: `lib/station/api.ts`, `lib/station/store.ts`, `lib/station/outbox.ts`
- Modify: `lib/station/resolve.ts`, `lib/station/prompt.ts`
- Modify: `app/api/resolve/route.ts`, `app/api/bind/route.ts`
- Modify: `app/station/StationScreen.tsx` (call sites only)
- Test: the `.test.ts` beside each

**Interfaces:**
- Produces: `CardSwipe = { token: string | null; nameParts: string[]; isCard: boolean }`
- Produces: `OutboxItem` binding variant becomes `{ kind: "binding"; token: string; netid: string }`
- Produces: `api.resolve(deviceToken, token: string)`, `api.bind(deviceToken, token: string, netid: string)`

- [ ] **Step 1: Rewrite the card parser test**

Replace the token assertions in `lib/scan/card.test.ts`. Keep every name and
typed-entry case already there; change only what the tokens are.

```ts
it("TAKES TRACK 1'S 15-DIGIT NUMBER, not track 2's 19", () => {
  // Track 2 is track 1 plus a four-digit suffix that has the shape of a card
  // issue number. Binding the base is the bet that it survives a reissue.
  expect(parseCardSwipe(REAL_SWIPE).token).toBe("999999000000123");
});

it("falls back to track 2 with its last four digits removed", () => {
  // Some readers emit track 2 alone. The suffix length is assumed to be 4.
  expect(parseCardSwipe(";9999990000001238700=?").token).toBe("999999000000123");
});

it("reads track 1 alone", () => {
  expect(parseCardSwipe("%999999000000123=ALICE/BROWNING?").token).toBe("999999000000123");
});

it("TREATS A TYPED ID AS ITSELF, not as a stripe", () => {
  const swipe = parseCardSwipe("ab1234");
  expect(swipe.isCard).toBe(false);
  expect(swipe.token).toBe("ab1234");
});

it("returns no token for an empty swipe", () => {
  expect(parseCardSwipe("").token).toBeNull();
});
```

Delete the two tests that assert on ordering and on de-duplication of the two
numbers — there is only one number now, so they no longer describe anything.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run lib/scan/card.test.ts
```

Expected: FAIL — `swipe.token` is undefined.

- [ ] **Step 3: Rewrite the parser**

In `lib/scan/card.ts`, replace the `CardSwipe` type and `parseCardSwipe`:

```ts
/** The four digits track 2 adds to track 1, assumed to be a card issue number. */
const ISSUE_SUFFIX_LENGTH = 4;

export type CardSwipe = {
  /** The card's identifier, or null when the swipe carried none. */
  token: string | null;
  /** The name printed on the stripe, if the card carries one. */
  nameParts: string[];
  /** True when this looked like a card rather than typed digits. */
  isCard: boolean;
};

export function parseCardSwipe(raw: string): CardSwipe {
  const trackOne = TRACK_ONE.exec(raw)?.[1];
  const trackTwo = TRACK_TWO.exec(raw)?.[1];

  const one = numberFrom(trackOne);
  const two = numberFrom(trackTwo);

  // Track 1's number is the base. Track 2 is the base plus a four-digit
  // suffix, so when track 1 is missing the suffix is trimmed back off rather
  // than a different number being stored for the same card.
  const token =
    one ??
    (two && two.length > ISSUE_SUFFIX_LENGTH
      ? two.slice(0, two.length - ISSUE_SUFFIX_LENGTH)
      : two);

  const nameParts = (trackOne?.split("=")[1] ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z][A-Za-z '.-]*$/.test(part));

  if (token) return { token, nameParts, isCard: true };

  const typed = raw.trim();
  return { token: typed || null, nameParts: [], isCard: false };
}
```

Update the module docstring: it currently explains why both numbers are bound.
Replace that paragraph with the reasoning above — the base is bound, and a
reissue that changes the base lands in the officer path.

- [ ] **Step 4: Follow the type through**

Change each of these to carry one token. The compiler will point at every
site; work through them until `npx tsc --noEmit` is clean.

- `lib/station/api.ts` — `resolve(deviceToken, token: string)` sending
  `{ token }`; `bind(deviceToken, token: string, netid: string)` sending
  `{ token, netid }`; `createGuest(..., token: string | null)`.
- `lib/station/store.ts` — the `OutboxItem` binding variant becomes
  `{ kind: "binding"; token: string; netid: string }`.
- `lib/station/outbox.ts` — `api.bind(deps.deviceToken, binding.token, binding.netid)`.
  Leave the 409/404 handling exactly as it is: 409 now also means "that person
  already had a card", which is still a poison pill that must leave the queue.
- `lib/station/resolve.ts` — one `store.resolveToken(token)` call, no loop;
  `api.resolve(deps.deviceToken, swipe.token)`. Leave the outcome shape alone
  for now; Task 4 changes it.
- `lib/station/prompt.ts` — `bindMember(token, netid, deps)` and
  `createGuest(token, netid, homeClub, deps)`, each doing one
  `store.addCredential` and enqueuing one binding.
- `app/api/resolve/route.ts` — read `body.token` only, and query
  `.eq("token", token)`. Delete the `tokens` array handling and update the
  docstring, which still describes taking a list.
- `app/api/bind/route.ts` — read `body.token` only; drop the `fresh`/`clashes`
  array logic in favour of a single-token clash check.
- `app/station/StationScreen.tsx` — `cards: string[]` becomes `token: string`
  in the `prompt`, `member-picker` and `guest-form` screen variants and at
  their call sites.

- [ ] **Step 5: Update the tests that assert on the old shapes**

`lib/station/resolve.test.ts`, `lib/station/prompt.test.ts`,
`lib/station/outbox.test.ts`, `lib/station/api.test.ts`,
`app/api/resolve/route.test.ts` and `app/api/bind/route.test.ts` all build
token arrays. Change them to single tokens. Do not weaken any assertion while
doing it — if a test asserted that both numbers were bound, it should now
assert that the base is bound and that the 19-digit number is not.

- [ ] **Step 6: Run everything**

```bash
npx tsc --noEmit && set -o pipefail && npm test 2>&1 | tail -20
```

Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F- <<'MSG'
feat: bind one number per card, not two

The stripe carries the same number twice - track 2 is track 1 plus a
four-digit suffix - and the old design bound both so that whichever survived a
reissue would keep working. That is now one row per card, holding track 1's
15-digit base.

The bet is that the base survives a reissue and the suffix is what changes. If
that is backwards, a replacement card lands in the officer path instead of
resolving. Loud rather than silent, which is the right way round for a guess
nobody can test without a reissued card.

A reader that emits track 2 alone has its last four digits trimmed rather than
storing a different number for the same card.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Candidates, and the typed netID path

The resolve layer stops saying "unknown card" and starts saying "here is who
this could be". Still no UI change — `StationScreen` is updated only enough to
compile, and Task 5 draws the screen.

**Files:**
- Modify: `lib/station/resolve.ts`, `lib/station/resolve.test.ts`
- Modify: `app/station/StationScreen.tsx` (call sites only)
- Modify: `lib/station/store.ts` — add `unboundPeople()`
- Test: `lib/station/store.test.ts`

**Interfaces:**
- Consumes: `nameCandidates` from Task 1; `CardSwipe.token` from Task 3.
- Produces: `ScanOutcome` gains
  `{ kind: "candidates"; token: string; candidates: CachedPerson[] }` and
  loses `{ kind: "prompt"; ... }`.
- Produces: `store.unboundPeople(): Promise<CachedPerson[]>`

- [ ] **Step 1: Write the failing store test**

In `lib/station/store.test.ts`, beside the existing `unboundMembers` test:

```ts
it("UNBOUND PEOPLE INCLUDES GUESTS, not only members", () => {
  // A guest who was entered by hand has no card. When they later swipe one,
  // they must be offered as a candidate the same way a member is.
});
```

Fill it in following the shape of the existing `unboundMembers` test in that
file: seed a member and a guest, bind one of them, assert both unbound people
come back and the bound one does not.

- [ ] **Step 2: Add `unboundPeople` to the store**

In `lib/station/store.ts`, beside `unboundMembers`:

```ts
    /**
     * Everyone with no card bound yet, members and guests alike.
     *
     * A guest entered by hand has a person row and no credential. When they
     * turn up later with a card, the name on it should offer them the same
     * way it offers a member.
     */
    async unboundPeople(): Promise<CachedPerson[]> {
      const [people, credentials] = await Promise.all([
        db.getAll("people"),
        db.getAll("credentials"),
      ]);
      const bound = new Set(credentials.map((c) => c.netid));
      return people.filter((p) => !bound.has(p.netid));
    },
```

Keep `unboundMembers` for now; Task 5 removes it along with `MemberPicker`.

- [ ] **Step 3: Write the failing resolve tests**

In `lib/station/resolve.test.ts`, replace the tests asserting a `prompt`
outcome with these. Follow the file's existing `deps` and seeding helpers.

```ts
it("OFFERS THE ONE MEMBER THE CARD NAMES", async () => {
  // The path 194 of 196 people take on their first swipe.
  const outcome = await resolveScan(REAL_SWIPE, deps);

  expect(outcome.kind).toBe("candidates");
  expect(outcome.candidates.map((p) => p.netid)).toEqual(["ab1234"]);
  expect(outcome.token).toBe("999999000000123");
});

it("OFFERS BOTH HEIDI LEES rather than choosing one", async () => {
  const outcome = await resolveScan(heidiSwipe, deps);

  expect(outcome.kind).toBe("candidates");
  expect(outcome.candidates).toHaveLength(2);
});

it("offers nobody when the card names nobody on the roster", async () => {
  const outcome = await resolveScan(strangerSwipe, deps);

  expect(outcome.kind).toBe("candidates");
  expect(outcome.candidates).toEqual([]);
});

it("EXCLUDES SOMEBODY WHO ALREADY HAS A CARD", async () => {
  // Once the first of the two is bound, the second swipe must offer only
  // the other one. Spec case 6.
  await store.addCredential("SOME-OTHER-CARD", "rh1000");

  const outcome = await resolveScan(heidiSwipe, deps);

  expect(outcome.candidates.map((p) => p.netid)).toEqual(["rh1001"]);
});

it("OFFERS CANDIDATES WITH THE SERVER UNREACHABLE", async () => {
  // Spec A6: a member is never stopped at the door by a dead network. The
  // match is local, so this works with no server at all.
  const outcome = await resolveScan(REAL_SWIPE, offlineDeps);

  expect(outcome.kind).toBe("candidates");
  expect(outcome.candidates.map((p) => p.netid)).toEqual(["ab1234"]);
});

it("CHECKS A TYPED NETID IN DIRECTLY, with no tile and no binding", async () => {
  // A typed netID is the identity. There is no card, so there is nothing to
  // bind, and asking "is this you?" would confirm what was just typed.
  const outcome = await resolveScan("ab1234", deps, "manual");

  expect(outcome.kind).toBe("checked-in");
  expect(outcome.person.netid).toBe("ab1234");
});

it("CHECKS A TYPED NETID IN EVEN WHEN THAT PERSON ALREADY HAS A CARD", async () => {
  // Matching only unbound people the way the card path does would send a
  // bound member to the guest form, which is wrong.
  await store.addCredential("AB-CARD", "ab1234");

  const outcome = await resolveScan("ab1234", deps, "manual");

  expect(outcome.kind).toBe("checked-in");
});

it("offers nobody for a typed netID it has never seen", async () => {
  const outcome = await resolveScan("zz9999", deps, "manual");

  expect(outcome.kind).toBe("candidates");
  expect(outcome.candidates).toEqual([]);
});
```

- [ ] **Step 4: Run to verify it fails**

```bash
npx vitest run lib/station/resolve.test.ts
```

Expected: FAIL — outcome kind is `prompt`, and typed netIDs do not check in.

- [ ] **Step 5: Rewrite `resolveScan`**

In `lib/station/resolve.ts`, replace the `prompt` variant of `ScanOutcome`:

```ts
  | {
      kind: "candidates";
      /** The card's token, carried so a chosen tile can bind it. */
      token: string;
      /** Unbound people the name could mean. May be empty. */
      candidates: CachedPerson[];
    }
```

and rewrite the tail of `resolveScan`:

```ts
  const swipe = parseCardSwipe(raw);
  if (!swipe.token) return { kind: "failed" };

  // A typed netID is the identity itself, so it resolves against the whole
  // roster - bound or not - and checks in with nothing to bind. Filtering to
  // unbound people the way the card path does would send a member who
  // already has a card to the guest form.
  if (!swipe.isCard) {
    const person = (await deps.store.allPeople()).find((p) => p.netid === swipe.token);
    if (person) return checkIn(person, meal.mealPeriod, at, entryMethod, deps);
    return { kind: "candidates", token: swipe.token, candidates: [] };
  }

  // Case 1.
  const cached = await deps.store.resolveToken(swipe.token);
  if (cached) return checkIn(cached, meal.mealPeriod, at, entryMethod, deps);

  const result = await deps.api.resolve(deps.deviceToken, swipe.token);

  // Case 2.
  if (result.ok) {
    await deps.store.putPerson(result.data);
    await deps.store.addCredential(swipe.token, result.data.netid);
    return checkIn(result.data, meal.mealPeriod, at, entryMethod, deps);
  }

  if (result.status === 401) return { kind: "unenrolled" };

  // Case 3 (404) and case 4 (no answer at all). The match is local, so an
  // unreachable server costs nothing here.
  if (result.status === 404 || result.status === null) {
    const unbound = await deps.store.unboundPeople();
    return {
      kind: "candidates",
      token: swipe.token,
      candidates: nameCandidates(swipe.nameParts, unbound),
    };
  }

  return { kind: "failed" };
}
```

Note the 401 check moves **above** the 404/null check. It is below it today,
which is harmless only because the two conditions are disjoint; putting the
definite answer first keeps it that way if the conditions ever widen.

Add `allPeople()` to the store beside `allMembers()`:

```ts
    async allPeople(): Promise<CachedPerson[]> {
      return db.getAll("people");
    },
```

Import `nameCandidates` from `@/lib/scan/name-match`.

- [ ] **Step 6: Make `StationScreen` compile**

Rename the `prompt` screen variant to `candidates`, carrying
`{ token: string; candidates: CachedPerson[] }`, and update `finish` to set
it. Leave the rendering as it is — Task 5 replaces it.

- [ ] **Step 7: Run and commit**

```bash
npx tsc --noEmit && set -o pipefail && npm test 2>&1 | tail -20
```

```bash
git add -A
git commit -F- <<'MSG'
feat: an unknown card offers who it could be

resolveScan stops answering "unknown card" and starts answering "here are the
unbound people this name could mean". The match runs against the local cache,
so it costs no network and works during an outage - which is what keeps A6's
promise that a member is never stopped at the door by dead Wi-Fi.

Candidates include guests, not only members. A guest entered by hand has a
person row and no card; when they later swipe one, the name should offer them
the same way it offers a member.

A typed netID now checks in directly instead of falling through to the unknown
card path. It is the identity itself, so there is nothing to bind and nothing
to confirm. It also resolves against the whole roster rather than the unbound
half, because otherwise a member who already has a card would type their netID
and be told to be a guest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: The candidates screen

The visible change. One screen replaces the "Card not recognised" prompt, the
Member/Guest fork, and the search over 196 names.

**Files:**
- Create: `app/station/Candidates.tsx`, `app/station/Candidates.test.tsx`
- Modify: `app/station/StationScreen.tsx`, `app/station/StationScreen.test.tsx`
- Modify: `app/station/GuestForm.tsx`, `app/station/GuestForm.test.tsx`
- Modify: `lib/station/prompt.ts` — the already-bound outcome
- Delete: `app/station/MemberPicker.tsx`, `app/station/MemberPicker.test.tsx`
- Modify: `lib/station/store.ts` — drop `unboundMembers`

**Interfaces:**
- Consumes: `ScanOutcome.candidates` from Task 4.
- Produces: `<Candidates people onPick onGuest onCancel dismissMs />`
- Produces: `ScanOutcome` gains `{ kind: "already-bound"; netid: string }`

- [ ] **Step 1: Write the failing component test**

Create `app/station/Candidates.test.tsx`. Test behaviour, not markup — no
snapshots, and nothing asserting a photo appears, because none exist.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Candidates } from "./Candidates";

const SAME_NAME = [
  { netid: "rh1000", fullName: "Robin Hale", isMember: true, homeClub: null, photoPath: null },
  { netid: "rh1001", fullName: "Robin Hale", isMember: true, homeClub: null, photoPath: null },
];

describe("Candidates", () => {
  it("SHOWS THE NETID, which is what tells two people with one name apart", async () => {
    // No headshots are loaded, and two people who share a full name share
    // their initials too. The netID is the only thing on the tile that
    // distinguishes them.
    render(<Candidates people={SAME_NAME} onPick={vi.fn()} onGuest={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("rh1000")).toBeInTheDocument();
    expect(screen.getByText("rh1001")).toBeInTheDocument();
  });

  it("hands back the netID that was tapped", async () => {
    const onPick = vi.fn();
    render(<Candidates people={SAME_NAME} onPick={onPick} onGuest={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /rh1001/ }));

    expect(onPick).toHaveBeenCalledWith("rh1001");
  });

  it("OFFERS THE GUEST ROUTE EVEN WITH NO TILES", async () => {
    // Zero candidates is the same screen, not a different one.
    const onGuest = vi.fn();
    render(<Candidates people={[]} onPick={vi.fn()} onGuest={onGuest} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /guest/i }));

    expect(onGuest).toHaveBeenCalled();
  });

  it("tells a member who does not see themselves where to go", () => {
    render(<Candidates people={[]} onPick={vi.fn()} onGuest={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/officer or the business manager/i)).toBeInTheDocument();
  });

  it("DISMISSES ITSELF EVENTUALLY, so a walked-away swipe does not hold the lane", async () => {
    // Short real duration, not fake timers: faking them freezes
    // fake-indexeddb, which resolves on real async scheduling.
    const onCancel = vi.fn();
    render(
      <Candidates people={[]} onPick={vi.fn()} onGuest={vi.fn()} onCancel={onCancel} dismissMs={20} />,
    );

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/station/Candidates.test.tsx
```

Expected: FAIL — cannot resolve `./Candidates`.

- [ ] **Step 3: Write the component**

Create `app/station/Candidates.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import type { CachedPerson } from "@/lib/station/store";
import { Avatar } from "./Avatar";

/**
 * How long this stays up before the lane is released.
 *
 * Result screens fall back to idle after 3 seconds. This one must not -
 * somebody is reading it and deciding. 30 seconds is long enough to choose
 * and short enough that a swipe walked away from does not block the tablet.
 */
export const CANDIDATES_DISMISS_MS = 30_000;

type CandidatesProps = {
  /** Unbound people the card's name could mean. May be empty. */
  people: CachedPerson[];
  onPick: (netid: string) => void;
  onGuest: () => void;
  onCancel: () => void;
  /** Injectable so a test need not wait 30 seconds or fake timers. */
  dismissMs?: number;
};

export function Candidates({
  people,
  onPick,
  onGuest,
  onCancel,
  dismissMs = CANDIDATES_DISMISS_MS,
}: CandidatesProps) {
  // Read through a ref? Not needed: onCancel is stable from StationScreen's
  // useCallback. If that ever changes, this effect would cancel its own
  // timer on every render - the failure that has bitten twice in this
  // codebase already.
  useEffect(() => {
    const timer = setTimeout(onCancel, dismissMs);
    return () => clearTimeout(timer);
  }, [onCancel, dismissMs]);

  return (
    <div className="flex flex-col items-center gap-8">
      <p data-testid="candidates" className="text-3xl">
        {people.length > 1 ? "Which one is you?" : "Is this you?"}
      </p>

      {people.length > 0 && (
        <div className="flex flex-wrap justify-center gap-6">
          {people.map((person) => (
            <button
              key={person.netid}
              type="button"
              onClick={() => onPick(person.netid)}
              className="flex flex-col items-center gap-3 rounded-2xl px-8 py-6 ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash"
            >
              <Avatar name={person.fullName} url={null} />
              <span className="font-display text-3xl">{person.fullName}</span>
              {/* Load-bearing, not decoration: two members share a full name,
                  and no headshots are loaded. */}
              <span className="text-lg text-ink-secondary">{person.netid}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button
          type="button"
          onClick={onGuest}
          className="rounded-xl px-8 py-4 text-xl ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash"
        >
          No, I&apos;m a guest
        </button>
        <button type="button" onClick={onCancel} className="px-4 text-ink-muted underline">
          Cancel
        </button>
      </div>

      <p className="max-w-md text-center text-sm text-ink-muted">
        If you are a member and you do not see yourself, please ask an officer
        or the business manager.
      </p>
    </div>
  );
}
```

The photo URL is passed as `null` for now. Wire it the way `checked-in` does
in `StationScreen` — via `photoUrl(store, person.photoPath)` — only if a
headshot set has landed by the time this task runs. It renders initials
otherwise, which is the current reality for all 196.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/station/Candidates.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add the already-bound outcome**

In `lib/station/prompt.ts`, `createGuest` must distinguish a 409 from a
general failure:

```ts
  const result = await deps.api.createGuest(deps.deviceToken, netid, homeClub, token);

  // Spec section 8. The one place the officer message appears: they typed a
  // netID and that person already has a card.
  if (!result.ok && result.status === 409) {
    return { kind: "already-bound", netid };
  }
  if (!result.ok) return { kind: "failed" };
```

Add the variant to `ScanOutcome` in `lib/station/resolve.ts`:

```ts
  /** The typed netID belongs to somebody who already has a card. */
  | { kind: "already-bound"; netid: string }
```

- [ ] **Step 6: Wire it into `StationScreen`**

- Replace the `prompt` and `member-picker` render blocks with one
  `candidates` block rendering `<Candidates />`.
- `onPick` → `finish(await bindMember(screen.token, netid, deps))`.
- `onGuest` → `setScreen({ kind: "guest-form", token: screen.token })`.
- `onCancel` → `setScreen({ kind: "idle" })`.
- Add an `already-bound` render block:

```tsx
      {screen.kind === "already-bound" && (
        <p data-testid="already-bound" className="max-w-2xl text-center text-3xl text-ink">
          That person already has a card —{" "}
          <span className="text-ink-secondary">please see an officer</span>
        </p>
      )}
```

  Route it through `hold(...)` so it clears like any other result.
- Delete the `MemberPicker` import, the `members.all` state and the
  `store.unboundMembers()` call from `refreshLocalState`.
- Delete `app/station/MemberPicker.tsx` and `app/station/MemberPicker.test.tsx`.
- Delete `unboundMembers` from `lib/station/store.ts` and its test.

- [ ] **Step 7: Update the station screen tests**

In `app/station/StationScreen.test.tsx`, replace assertions on
`getByTestId("prompt")` and the member-picker flow with the candidates flow.
Add one that pins the whole first-swipe journey:

```tsx
it("BINDS ON THE FIRST SWIPE AND IS INSTANT ON THE SECOND", async () => {
  // The journey all 196 members take at go-live.
  render(<StationScreen {...props} />);

  fireScan(REAL_SWIPE);
  await screen.findByTestId("candidates");
  await userEvent.click(screen.getByRole("button", { name: /ab1234/ }));
  expect(await screen.findByTestId("checked-in")).toBeInTheDocument();

  fireScan(REAL_SWIPE);
  expect(await screen.findByTestId("checked-in")).toBeInTheDocument();
  expect(screen.queryByTestId("candidates")).not.toBeInTheDocument();
});
```

- [ ] **Step 8: Run and commit**

```bash
npx tsc --noEmit && set -o pipefail && npm test 2>&1 | tail -20
```

```bash
git add -A
git commit -F- <<'MSG'
feat: the first swipe confirms a name instead of searching for one

"Card not recognised", the Member/Guest fork and the search over 196 names are
replaced by one screen showing the people the card's name could mean. Zero,
one and many are the same screen; only the number of tiles changes.

Each tile carries a netID, and that is load-bearing rather than decoration. No
headshots are loaded - photo_path is null for all 196 - and the two members
who share a full name also share their initials. The netID is the only thing
on the tile that tells them apart, and each of them knows their own.

It dismisses after 30 seconds rather than the 3 that result screens use.
Somebody is reading this one.

MemberPicker and store.unboundMembers go with it. Nothing reaches them any
more: a member the matcher misses is recovered by typing their netID at the
guest form, which binds and checks them in as a member.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: Guest names from the stripe

A guest who swipes should appear by name, not as a bare netID.

**Files:**
- Modify: `lib/station/api.ts`, `lib/station/prompt.ts`
- Modify: `app/api/guests/route.ts`, `app/api/guests/route.test.ts`
- Modify: `app/station/StationScreen.tsx` (pass `nameParts` through)

**Interfaces:**
- Produces: `api.createGuest(deviceToken, netid, homeClub, token, cardName?: string[])`
- `/api/guests` accepts `cardName?: string[]`.

- [ ] **Step 1: Write the failing test**

In `app/api/guests/route.test.ts`:

```ts
it("NAMES A NEW GUEST FROM THE CARD instead of their netID", async () => {
  // O2 is still a stub, so without this a guest is recorded as "ab1234".
  // The stripe already carries their name.
  const res = await POST(guestRequest("newguest1", "Cannon", "GUEST-NAMED", ["ALICE", "BROWNING"]));

  const { data } = await res.json();
  expect(data.fullName).toBe("Alice Browning");
});

it("NEVER OVERWRITES AN EXISTING PERSON'S NAME", async () => {
  // A card name is used only when creating somebody. A member whose card is
  // mis-read must not be renamed by it.
  const res = await POST(guestRequest("bindmember01", "Cap & Gown", "GUEST-NO-RENAME", ["WRONG", "NAME"]));

  const { data } = await res.json();
  expect(data.fullName).toBe("Bind Member");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/api/guests/route.test.ts
```

Expected: FAIL — `fullName` is the netID.

- [ ] **Step 3: Implement**

In `app/api/guests/route.ts`, read the card name and use it only on insert:

```ts
  const cardName: string[] = Array.isArray(body?.cardName)
    ? body.cardName.filter((p: unknown): p is string => typeof p === "string")
    : [];

  /**
   * "ALICE/BROWNING" -> "Alice Browning".
   *
   * Used only when creating somebody. An existing person keeps the name they
   * already have: a member whose card was mis-read into this flow must not be
   * renamed by their own stripe, and a departed member eating as a guest keeps
   * the name their swipe history is attached to.
   */
  const nameFromCard = cardName
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
```

Then in the insert, replace `full_name: directory.fullName ?? netid` with:

```ts
        // The stripe is the best name we have until O2 closes. A typed netID
        // carries no name at all, so that case still falls back to the netID.
        full_name: directory.fullName ?? nameFromCard || netid,
```

Pass `nameParts` through `api.createGuest`, `prompt.createGuest`, and the
`guest-form` screen variant in `StationScreen` — the variant must carry
`nameParts` alongside `token`, set from the candidates outcome.

That means `ScanOutcome`'s `candidates` variant also carries `nameParts`. Add
it in `lib/station/resolve.ts` and set it from `swipe.nameParts`.

- [ ] **Step 4: Run and commit**

```bash
npx tsc --noEmit && set -o pipefail && npm test 2>&1 | tail -20
```

```bash
git add -A
git commit -F- <<'MSG'
feat: a guest who swipes is recorded by name

The directory lookup is still a stub, so until now a new guest was stored as
their netID and the guest ledger read as a column of logins. The stripe
carries their name, so a guest who swipes a card now gets a real one with no
directory integration at all.

Only on creation. An existing person keeps the name they have - a member whose
card was mis-read into this flow must not be renamed by their own stripe, and
a departed member eating as a guest keeps the name their history hangs off.

A typed netID still carries no name, so that path still falls back to the
netID and still wants O2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: End to end, and the documents

**Files:**
- Modify: `e2e/station.spec.ts` (or the nearest existing station spec)
- Modify: `docs/specs/2026-08-16-meal-attendance-system-design.md`
- Modify: `docs/HANDOFF.md`
- Modify: `AGENTS.md` if any statement in it is now wrong

- [ ] **Step 1: Write the end-to-end journey**

Playwright runs against a production build, not `next dev`. Add to the station
spec:

```ts
test("a member's first swipe binds, and the second is instant", async ({ page }) => {
  // The go-live journey. Every one of 196 members does this once.
  await enrolAndOpenStation(page);

  await swipe(page, REAL_SWIPE);
  await expect(page.getByTestId("candidates")).toBeVisible();
  await page.getByRole("button", { name: /ab1234/ }).click();
  await expect(page.getByTestId("checked-in")).toBeVisible();

  await swipe(page, REAL_SWIPE);
  await expect(page.getByTestId("checked-in")).toBeVisible();
  await expect(page.getByTestId("candidates")).toHaveCount(0);
});
```

Reuse the file's existing enrolment and swipe helpers rather than adding new
ones. Park and restore any roster rows the test touches — the local database
holds the real 196-member roster and the suite runs serially against it.

- [ ] **Step 2: Run the end-to-end suite**

```bash
set -o pipefail; npm run test:e2e 2>&1 | tail -30
```

Expected: PASS, including the existing offline drill.

- [ ] **Step 3: Update the original design document**

In `docs/specs/2026-08-16-meal-attendance-system-design.md`:

- A1: note that it is amended by the 2026-08-26 spec, and that one token per
  card is bound, not two.
- A3: add that a name narrows and never identifies, pointing at A8.
- Section 8: replace the many-tokens-to-one-netID description with one card
  per person and the 409.
- Open questions: annotate O2 with what the card now provides and what still
  needs the directory; leave O5 open but record why it is not blocking.

Add a line at the top of the file pointing at the amending spec, so a reader
who starts there is not misled.

- [ ] **Step 4: Update the handoff**

In `docs/HANDOFF.md`:

- "Where things stand": update the test counts and note the redesign.
- "Things that look wrong and are not": replace the entry saying `credentials`
  maps many tokens to one person. It now maps one to one, and the reasoning
  has inverted.
- "Traps": add that a card's printed name is never an identity, with the duplicate
  full name and the shared hyphenated surname as the evidence.
- "What is left": add the officer tool as deferred work, due well before the
  February roster jump, and the O2 verification.

- [ ] **Step 5: Final verification and commit**

```bash
npx tsc --noEmit && npm run lint && set -o pipefail && npm test 2>&1 | tail -20
```

```bash
set -o pipefail; npm run test:e2e 2>&1 | tail -30
```

Both must be green before committing. Report the actual counts.

```bash
git add -A
git commit -F- <<'MSG'
docs: bring the design and the handoff in line with one card per person

The 2026-08-16 spec still described binding both stripe numbers and a
credentials table mapping many tokens to one person. Both are now wrong, and
the handoff listed the many-to-one mapping under "things that look wrong and
are not" - which would have sent the next reader to defend a design that has
been replaced.

Also records the trap that cost the most time to find here: a card's printed
name is never an identity. Two members share a full name, eight surnames
collide, and a flat word match let a hyphenated surname match a relative.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Self-review

**Spec coverage.** Section 2 → Task 1. Section 3 A1 → Task 3; A8 → Task 1 and
Task 4. Section 4 → Task 1. Section 5 → Task 4. Section 6 → Task 4. Section 7
→ Task 5. Section 8 → Tasks 2, 5, 6. Section 9's case table → Tasks 2, 4, 5
and the end-to-end test in Task 7. Section 10 → recorded in Task 7's handoff
edit. Section 11 → Task 6 and Task 7. Section 12 → the tests in every task.
Section 13 → the task order.

**Type consistency.** `CardSwipe.token` (Task 3) is consumed by `resolveScan`
(Task 4). `ScanOutcome.candidates` and `.token` (Task 4) are consumed by
`<Candidates>` (Task 5). `nameCandidates` (Task 1) is called in Task 4 with
`swipe.nameParts` and `store.unboundPeople()`. `already-bound` is produced in
Task 5's `prompt.ts` and rendered in Task 5's `StationScreen`. `cardName`
(Task 6) threads `api.createGuest` → `/api/guests`, which required adding
`nameParts` to the `candidates` outcome and the `guest-form` screen variant —
noted in Task 6 Step 3.

**Known ordering constraint.** Task 6 widens two shapes Task 4 and Task 5
created. That is deliberate: threading the card name through before the screen
exists would mean writing it twice.
