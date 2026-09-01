# Card identity and the first swipe

**Status: approved 2026-08-26. Amends the 2026-08-16 system design.**

This document replaces how the system decides *who just swiped*. It changes
assumption A1, adds A8, rewrites section 8's binding rules, and removes a
screen. Read it against
`docs/specs/2026-08-16-meal-attendance-system-design.md`, which stays
authoritative for everything it does not touch.

---

## 1. Why this exists

A real member swiped a real TigerCard and the station said **"Card not
recognised"**.

Nothing was broken. The reader worked, the parser worked, and the server
answered correctly. `people` holds `ab1234 | Alice Browning | is_member = t`.
The lookup failed because `credentials` was empty — zero rows, on both the
local database and production.

The defect is in the assumption, not the code. The system treats *"do we know
this person"* and *"do we know this card"* as one question. They are two
questions, and only the second one had an answer.

The size of that is what forces the redesign:

> At go-live, the first swipe of **every one of 196 members** shows "Card not
> recognised". That is not an edge case. That is opening night.

The old design answered this with a prompt and a search over 196 names, once
per person. The magnetic stripe makes that unnecessary, because it tells us
the holder's name at the moment they swipe.

## 2. What the stripe gives us, and what it cannot

A TigerCard produces one 54-character burst carrying two numbers and a name.
The structure below is measured; the number and name are synthetic:

```
%999999000000123=ALICE/BROWNING?;9999990000001238700=?
 └── 15 digits ──┘ └── name ──┘  └──── 19 digits ────┘
                                      = the 15, plus 8700
```

**The name is not an identity.** Measured against the real 196-member roster:

```
2 members share one full name, exactly
8 surnames are shared: one by 4 people, one by 3, six more by 2
```

A card also carries the name of *any* Princeton student, not only a member, and
the guest population is effectively unbounded. So the name can never be the
key.

**The name is an excellent hint.** It reduces "search 196 names" to "confirm
the one name already on screen" for 194 of 196 people, and to "pick between
two" for the other two.

## 3. Assumption changes

**A1 — amended twice.** One token per card, not two. The token is **track 1's
number, whatever its length**.

The "15-digit" claim held for one card and was wrong. Four real cards were
measured on 2026-08-31: three were 15 digits behind issuer prefix `60162192`,
and a fourth was **17 digits** behind `60162196`. Nothing in the code ever
depended on the length — the token is whatever track 1 says, which is stable
per card, and that is all a binding needs. But the number was written down as
a fact in three places and it was not one.

One consequence is still unmeasured: the track-2-only fallback trims exactly
four digits, and no card with a 17-digit track 1 has been read on track 2
alone. If such a card's suffix is not four digits, a track-2-only read would
produce a different token than a track-1 read of the same card. The reader in
use emits both tracks, so this has never been exercised. Track 2 is the same number plus a four-digit suffix
(`8700`) that has the shape of a card issue number. We assume the 15-digit
base is stable across a reissue. If a card presents no track 1, take track 2
minus its last four digits; the suffix length is assumed to be four.

The previous design bound both numbers so that whichever survived a reissue
would keep working. That is dropped in favour of one clean row per card. The
cost is a reissue where the base changes rather than the suffix, which lands
in the officer path in section 8. That is a loud failure, not a silent one.

**A8 — new. A name narrows; it never identifies.** No path may check a person
in on the strength of a name alone. A name match produces *candidates*. A
human always chooses among them, and the choice is shown with a netID so it
can be checked. This is the rule that makes the rest of the design safe.

**A3 is unchanged.** netID remains the canonical identity.

## 4. The name matcher

A new pure module, `lib/scan/name-match.ts`. No I/O, no dependencies.

**A name is a list of chunks, and each chunk is the set of forms it might
take.** Split on whitespace, then for each chunk:

1. Strip accents — `Renée` → `RENEE`.
2. Remove apostrophes and periods — `O'Brien` → `OBrien`.
3. Emit the chunk with all punctuation removed — `Harper-Stone` →
   `HARPERSTONE`.
4. Also emit its hyphen-split parts — `HARPER`, `STONE`.
5. Uppercase. Discard anything one character long, which drops middle
   initials.

So `Lily Harper-Stone` becomes
`[{LILY}, {HARPERSTONE, HARPER, STONE}]`. Steps 3 and 4 together are
what make the match survive a card that writes a hyphenated surname without
its hyphen — verified below to be necessary.

**Match rule: two or more chunks correspond.** A card chunk corresponds to a
roster chunk when their form-sets intersect. Each roster chunk may be claimed
only once. The card must carry at least two chunks to match anything at all.

Chunks rather than a flat bag of words, because a flat bag lets one hyphenated
surname supply two or three shared words by itself. Under the flat rule,
`ANNA/HARPER-STONE` matched `Lily Harper-Stone` on the surname
alone — a false positive between two plausible relatives at the same club.
Counting corresponding chunks requires the first name to agree too.

Correspondence is unordered, so the match does not care whether the card sends
`FIRST/LAST` or `LAST/FIRST`. We hold exactly one real card and cannot know
which, so not depending on the order is worth a great deal.

Two or more, rather than "every card chunk must correspond", because the two
scored identically on the real roster but differ on the thing we are blind to:
if a card carries a middle name the roster lacks, the strict rule fails and
this one still works. One corresponding chunk is never a match, which is what
keeps the four Wards apart.

### Measured against the real roster

Simulated across three different guesses at what the card sends:

```
card = full name        194 single candidate,  2 candidates: 2,  self-miss: 0
card = first + last     194 single candidate,  2 candidates: 2,  self-miss: 0
card = first + second   194 single candidate,  2 candidates: 2,  self-miss: 0

punctuation dropped by the card:
  VINCENT/DAMICO              -> Vincent D'Amico
  LEILA/ASHWORTHVANCE         -> Leila Ashworth-Vance
  LILY/HARPERSTONE            -> Lily Harper-Stone
  RENEE/DUBOIS                -> Renée Dubois

the false positive the chunk rule exists to prevent:
  LILY/HARPER-STONE           -> Lily Harper-Stone
  ANNA/HARPER-STONE           -> no match

cross-matches between different people: 2 — the shared full name, correctly
```

The rule choice barely moves these numbers, which is the useful finding: this
does not need to be clever. It needs to be predictable and to fail into a
human-checked screen.

Note the seven double surnames — one of them four words long — which is why no positional "last word is the surname" rule was
considered.

## 5. The scan path

1. Parse the stripe. Take the 15-digit base token.
2. **Local cache.** Hit → check in. No network at all. This is nearly every
   swipe after the first week, and the 500 ms budget applies here.
3. **One server call.** Hit → check in, and cache it forever.
4. **Server says no, or does not answer** → match the card's name against
   every **unbound person in the local cache — members and guests alike**.
5. Show the candidates screen.

Step 4 is entirely local, so an unbound member resolves with the network down.
That preserves A6's guarantee that a member is never stopped at the door by a
dead network.

## 6. The typed netID path

Manual entry is not a card. There is no token, so nothing is bound.

A typed netID **is** the identity, so it resolves against the **whole roster**,
bound or not — the card path's "unbound only" filter would wrongly send a
member who already has a card to the guest form.

| Typed netID is | Outcome |
|---|---|
| A member | Check in directly |
| A guest we have seen before | Check in directly |
| Never seen | Guest form, asking only for their club |

## 7. The candidates screen

The zero, one, and many cases are one screen. Only the number of tiles
changes. This replaces both the "Card not recognised" prompt and
`MemberPicker`, and the search over 196 names disappears with them.

```
                     Is this you?

        ┌───────────┐   ┌───────────┐
        │  photo    │   │  photo    │     one tile per matching
        │ Robin Hale│   │ Robin Hale│     UNBOUND person; N may be 0
        │  rh1000   │   │  rh1001   │
        └───────────┘   └───────────┘

                 [ No, I'm a guest ]              [ Cancel ]

      If you are a member and you do not see yourself,
        please ask an officer or the business manager.
```

**The netID on each tile is load-bearing, not decoration.** No headshot exists
yet — `photo_path` is null for all 196, and O5 may not close before go-live.
The two members who share a full name share their initials too, so a
photo-only tile would be unusable. Each of them knows their own netID. Photos
make the screen faster to read; the netID is what makes it correct.

**Timing.** Result screens fall back to idle after 3 seconds. This screen must
not — somebody is reading it. It dismisses after **30 seconds**, and offers
Cancel.

**Tap a tile** → bind the token to that netID → check in.
**Tap "No, I'm a guest"** → the guest form.

## 8. Binding rules

**One person, one card.** `credentials` gets a unique index on `netid`.

This reverses the original schema comment, which promised that "a replacement
card adds a row; nothing is ever overwritten, so a bad binding stays
recoverable". Recoverability now comes from an officer detaching a binding
rather than from stacking rows. The constraint is worth the trade because it
makes the rule true in the database rather than merely in application code —
in particular it makes the two-lane race in section 10 impossible instead of
loud.

Verified safe to apply: `credentials` holds **0 rows locally and 0 in
production**, so the index applies with no conflict.

**Server enforcement.** `/api/bind` and `/api/guests` both return **409** when
the netID already has a card. `/api/bind` today refuses only a *token* bound
to a different person; refusing a *person* who already has a card is new.

**Where the officer message appears.** In exactly one place: you submit the
guest form and the netID you typed already has a card. It never appears on the
scan path.

**A guest created from a card takes their name from the stripe.** A card name
is used only when **creating** a new person. It never overwrites an existing
person's name.

## 9. The full case table

| | Situation | Outcome |
|---|---|---|
| 1 | Card bound, cached | Instant check-in |
| 2 | Card bound, not cached, server answers | Check in, cache it |
| 3 | Card bound elsewhere, server unreachable | Candidates screen; they tap themselves; the same token re-binds, so it is idempotent |
| 4 | Unbound card, one unbound name match | One tile |
| 5 | Unbound card, two matches (the shared full name) | Two tiles |
| 6 | The second of them swipes after the first bound | One tile — the other one |
| 7 | Name matches only people who already have cards | Zero tiles → guest form → their own netID → checked in as a guest |
| 8 | `SAM/OKAFOR` on the card, `Samuel Okafor` on the roster | Zero tiles → guest form → types `so4210` → **bound and checked in as a member** |
| 9 | Replacement card whose base changed | Zero tiles → guest form → netID → **409, see an officer** |
| 10 | A guest taps a member's tile by mistake | Wrong binding. Caught only by the netID and photo on the tile. The accepted residual risk |
| 11 | Both of them, two lanes, same minute | Both lanes believe both are unbound. The unique index refuses the second binding |
| 12 | Typed netID, member or known guest | Check in directly |
| 13 | Typed netID, never seen | Guest form, club only |

Case 8 already works: `/api/guests` looks the netID up first and returns an
existing person untouched, preserving `is_member`. It needs a test that pins
the behaviour, not new logic.

## 10. Deferred, and why that is safe

**The officer tool.** Nothing in the dashboard can view or detach a binding.
Case 9 and case 11 therefore end with a human. The interim procedure is that
the officer fetches the person who maintains the system, who fixes it by
hand against the database.

This is deliberate. Both cases require a reissued or contested card, neither
can happen before a card has been bound at all, and go-live is a week away.
Building a dashboard page for an event that cannot occur in the first week is
worse than spending that week on the path all 196 people take. It should be
built well before the February roster jump, when ~100 new members and their
new cards arrive.

## 11. Open questions this touches

**O2 — CLOSED 2026-08-29.** Princeton's LDAP directory answers anonymous
queries over the public internet: no credential, no VPN, no application.
Verified from a deployed Vercel function in `iad1` at 15 ms plaintext and
45 ms TLS, and all 196 members resolve. `lib/directory/ldap.ts` is the whole
of it.

It does two jobs, and the second matters more than the first. It supplies a
name for a guest typed in by hand — the last case the card could not cover.
And it **refuses a netID that cannot exist**: `ak2102` for `ak2101` is
well-formed, passes every local check, and used to invent a person no later
query could tell from a real guest.

The rule the design rests on: *no such person* and *I could not ask* are never
confused. Only the first may refuse anybody. A directory that is slow, down,
or unreachable refuses nobody, and the guest is created exactly as before —
which is why nothing about this can stop a lane.

The TigerBook API was investigated and is dead: its host returns Heroku's "no
such app" page and there is no successor. The OIT Active Directory API works
and covers staff and graduate students too, but needs a faculty-sponsored
service account and one on-campus session — and eating clubs are not
University entities, so it may not be granted at all.

**What follows below was the position before that, kept because it explains
why the card path was built not to need a directory.**
A card swipe hands us a real name, so any guest who swipes appears by name
with no directory at all. A **typed** netID does not: `lookupNetid` is still a
stub returning a null name, so a manually-entered new guest is stored with
their netID as their name. The lookup still needs to be proven to work from a
Vercel function. Not a blocker — it is the difference between a guest ledger
of names and one of netIDs.

A consequence worth knowing before it is a surprise: a guest entered by hand
today is stored as `full_name = "ab1234"`. When they later swipe a card, the
stripe name will not match that record, so they get zero tiles and pass
through the guest form once more before being bound. Correct either way; one
extra step until O2 closes.

**O5 — headshots — stays non-blocking**, for the reason given in section 7.
The netID carries the disambiguation on its own.

## 12. Testing

Following the standing bar: test what can genuinely be wrong, and say what is
deliberately not tested.

**Tested**

- **The name matcher.** The duplicate-full-name pair returning
  two candidates; the four Kims separating on one shared word; accents,
  apostrophes, hyphens split and joined, four-word double surnames, middle
  names present on one side and absent on the other; a single-word card name
  never matching; and two relatives sharing a hyphenated surname not matching
  each other, which is the case that killed the first version of the rule.
- **The card parser.** Base extracted from track 1; track-2-only fallback
  dropping four digits; a typed value passing through as not-a-card.
- **`resolveScan` across the case table** — every row of section 9, including
  the offline and server-unreachable paths.
- **`/api/bind` and `/api/guests` against a real database** — the 409 when a
  netID already has a card, and case 8 checking a member in as a member.
- **The unique index itself** — a second binding for the same netID is
  refused by the database, not merely by the route.
- **End to end** — first swipe shows a tile, binding it makes the second
  swipe instant.

**Not tested, deliberately**

- Rendering of the tiles, and any snapshot of the screen. These break on
  every copy change and have never caught a defect in this project.
- The IndexedDB layer re-tested through the UI. `store.test.ts` covers it
  directly.
- Any assertion that a photo appears. There are no photos, and the code path
  is a null check that already has coverage.

## 13. Sequence

Each step leaves the system shippable.

1. The name matcher, as a pure module with its tests. Nothing wired.
2. Single-token binding — parser, store, api, outbox, routes, migration.
3. The server rules — 409 on a netID that already has a card.
4. The candidates screen; delete `MemberPicker`.
5. The typed netID path.
6. Guest names from the stripe.
7. Spec and `HANDOFF.md` updated to match.
