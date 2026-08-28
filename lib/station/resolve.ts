import { deriveMeal } from "@/lib/meals/derive";
import { parseCardSwipe } from "@/lib/scan/card";
import { nameCandidates } from "@/lib/scan/name-match";
import type { StationStore, CachedPerson } from "./store";
import type { StationApi } from "./api";

export type ScanOutcome =
  | { kind: "no-meal" }
  | { kind: "checked-in"; person: CachedPerson; mealPeriod: string }
  | {
      kind: "candidates";
      /**
       * The card token to bind, or null when there is nothing bindable.
       *
       * Null for typed entry. A netID is an identity, not a credential, and
       * writing one into `credentials` makes that person look bound — so
       * their real card would later find no tile and send them to an officer.
       */
      card: string | null;
      /** Unbound people the printed name could mean. May be empty. */
      candidates: CachedPerson[];
      /** The name the stripe carried, if any. */
      nameParts: string[];
      /** How the identifier arrived, carried through to whatever is recorded. */
      entryMethod: "scan" | "manual";
    }
  | { kind: "failed" }
  /** The typed netID belongs to somebody who already has a card. */
  | { kind: "already-bound"; netid: string }
  /** The server says this tablet is not enrolled. It must be set up again. */
  | { kind: "unenrolled" };

export type ResolveDeps = {
  store: StationStore;
  api: StationApi;
  deviceToken: string;
  /** Injectable so tests can stand at a known moment. */
  now?: () => Date;
};

/**
 * Queue a swipe. Called on every check-in, including repeats.
 *
 * The tablet deliberately does NOT deduplicate. A second scan in the same
 * meal queues a second swipe and the database's primary key collapses it.
 * Duplicating that rule here would mean two places to be wrong, and the
 * tablet is the one that cannot see the other two lanes.
 *
 * The item carries a netID, never a card token, which is why the outbox has
 * no ordering constraints: a swipe never waits on its binding.
 */
async function queueSwipe(
  store: StationStore,
  netid: string,
  at: Date,
  entryMethod: "scan" | "manual",
): Promise<void> {
  await store.enqueue({
    kind: "swipe",
    netid,
    scannedAt: at.toISOString(),
    entryMethod,
  });
}

export async function checkIn(
  person: CachedPerson,
  mealPeriod: string,
  at: Date,
  entryMethod: "scan" | "manual",
  deps: ResolveDeps,
): Promise<ScanOutcome> {
  await queueSwipe(deps.store, person.netid, at, entryMethod);
  return { kind: "checked-in", person, mealPeriod };
}

/**
 * The four cases from the spec, in order of how often they happen.
 *
 * 1. The token is cached — no network at all. This is essentially every scan
 *    during a rush, and it is the path the 500ms budget applies to.
 * 2. Not cached, the server knows it — one round trip, then cached forever.
 * 3. Not cached, the server says it has never seen it — offer the unbound
 *    people whose name the card could mean.
 * 4. Not cached, the server does not answer — offer them anyway. The name
 *    match is local, so a member resolves fully offline; a guest cannot, and
 *    is abandoned later in createGuest. That is the one accepted loss.
 *
 * A typed netID is none of these. It is the identity itself, so it resolves
 * against the whole roster and checks in with nothing to bind.
 */
export async function resolveScan(
  raw: string,
  deps: ResolveDeps,
  entryMethod: "scan" | "manual" = "scan",
): Promise<ScanOutcome> {
  const at = deps.now?.() ?? new Date();

  const meal = deriveMeal(at, await deps.store.getSchedule());
  if (!meal) return { kind: "no-meal" };

  // One token per card: track 1's 15-digit base.
  const swipe = parseCardSwipe(raw);
  if (!swipe.token) return { kind: "failed" };

  // A typed netID is the identity, not a credential. It searches the WHOLE
  // roster rather than the unbound half: filtering the way the card path does
  // would send a member who already has a card to the guest form.
  if (!swipe.isCard) {
    const person = (await deps.store.allPeople()).find((p) => p.netid === swipe.token);
    if (person) return checkIn(person, meal.mealPeriod, at, entryMethod, deps);
    return { kind: "candidates", card: null, candidates: [], nameParts: [], entryMethod };
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

  // The tablet's token is dead — revoked from the dashboard, or its device
  // row is gone. Reporting this as "could not reach the server" sends staff
  // to check the Wi-Fi for a problem no amount of network will fix, and the
  // tablet stays stuck forever. Say what it actually is. Checked before the
  // 404/no-answer pair so a definite answer is never read as silence.
  if (result.status === 401) return { kind: "unenrolled" };

  // Case 3 (404) and case 4 (no answer at all). The match is local, so an
  // unreachable server costs nothing here.
  if (result.status === 404 || result.status === null) {
    return {
      kind: "candidates",
      card: swipe.token,
      candidates: nameCandidates(swipe.nameParts, await deps.store.unboundPeople()),
      nameParts: swipe.nameParts,
      entryMethod,
    };
  }

  // A definite answer that is neither "here they are" nor "never seen it" —
  // a server fault. A local prompt cannot fix it, so say so rather than
  // letting an operator bind someone into a void.
  return { kind: "failed" };
}
