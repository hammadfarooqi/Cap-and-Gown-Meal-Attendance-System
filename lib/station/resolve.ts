import { deriveMeal } from "@/lib/meals/derive";
import { parseCardSwipe } from "@/lib/scan/card";
import type { StationStore, CachedPerson } from "./store";
import type { StationApi } from "./api";

export type ScanOutcome =
  | { kind: "no-meal" }
  | { kind: "checked-in"; person: CachedPerson; mealPeriod: string }
  | {
      kind: "prompt";
      /** Every identifier the swipe carried; all of them get bound. */
      cards: string[];
      /** The name the stripe carried, if any — used to pre-fill the picker. */
      nameParts: string[];
    }
  | { kind: "failed" }
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
 * 3. Not cached, the server says it has never seen it — prompt.
 * 4. Not cached, the server does not answer — prompt anyway. A member
 *    resolves fully offline from the cached roster; a guest cannot, and is
 *    abandoned later in createGuest. That is the one accepted loss.
 */
export async function resolveScan(
  raw: string,
  deps: ResolveDeps,
  entryMethod: "scan" | "manual" = "scan",
): Promise<ScanOutcome> {
  const at = deps.now?.() ?? new Date();

  const meal = deriveMeal(at, await deps.store.getSchedule());
  if (!meal) return { kind: "no-meal" };

  // A magnetic stripe carries two numbers, either of which may be the one
  // this person was bound under.
  const swipe = parseCardSwipe(raw);
  if (swipe.tokens.length === 0) return { kind: "failed" };

  // Case 1.
  for (const token of swipe.tokens) {
    const cached = await deps.store.resolveToken(token);
    if (cached) return checkIn(cached, meal.mealPeriod, at, entryMethod, deps);
  }

  const result = await deps.api.resolve(deps.deviceToken, swipe.tokens);

  // Case 2.
  if (result.ok) {
    await deps.store.putPerson(result.data);
    for (const token of swipe.tokens) {
      await deps.store.addCredential(token, result.data.netid);
    }
    return checkIn(result.data, meal.mealPeriod, at, entryMethod, deps);
  }

  // Case 3 (404) and case 4 (no answer at all).
  if (result.status === 404 || result.status === null) {
    return { kind: "prompt", cards: swipe.tokens, nameParts: swipe.nameParts };
  }

  // The tablet's token is dead — revoked from the dashboard, or its device
  // row is gone. Reporting this as "could not reach the server" sends staff
  // to check the Wi-Fi for a problem no amount of network will fix, and the
  // tablet stays stuck forever. Say what it actually is.
  if (result.status === 401) return { kind: "unenrolled" };

  // A definite answer that is neither "here they are" nor "never seen it" —
  // a server fault. A local prompt cannot fix it, so say so rather than
  // letting an operator bind someone into a void.
  return { kind: "failed" };
}
