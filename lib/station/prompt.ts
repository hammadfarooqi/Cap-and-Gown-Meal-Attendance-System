import { deriveMeal } from "@/lib/meals/derive";
import { checkIn, type ResolveDeps, type ScanOutcome } from "./resolve";

/**
 * Bind a card to a member the operator picked, then check them in.
 *
 * This works entirely offline. The tablet already holds the roster and the
 * photos, so the only thing the server is needed for is recording the
 * binding — and that goes in the outbox like everything else.
 *
 * Spec case 4, member path: this is why a network outage never stops a
 * member at the door.
 */
export async function bindMember(
  card: string,
  netid: string,
  deps: ResolveDeps,
): Promise<ScanOutcome> {
  const at = deps.now?.() ?? new Date();

  const meal = deriveMeal(at, await deps.store.getSchedule());
  if (!meal) return { kind: "no-meal" };

  const people = await deps.store.allMembers();
  const person = people.find((p) => p.netid === netid);
  if (!person) return { kind: "failed" };

  await deps.store.addCredential(card, netid);
  await deps.store.enqueue({ kind: "binding", token: card, netid });

  return checkIn(person, meal.mealPeriod, at, "manual", deps);
}

/**
 * Create a guest, then check them in.
 *
 * Unlike a member, this NEEDS the server: the person does not exist yet, and
 * the netID has to be validated against the directory. Spec A6 says an
 * operation that needs the server and does not get it is abandoned — no
 * queue, no reconciliation, the count is simply lost.
 *
 * That is the one lossy path in the whole system, and it is deliberate. It
 * requires a brand-new guest AND an unreachable server at the same moment.
 * Building a recovery queue for that was judged more expensive than the
 * occasional missing count.
 */
export async function createGuest(
  card: string | null,
  netid: string,
  homeClub: string,
  deps: ResolveDeps,
): Promise<ScanOutcome> {
  const at = deps.now?.() ?? new Date();

  const meal = deriveMeal(at, await deps.store.getSchedule());
  if (!meal) return { kind: "no-meal" };

  const result = await deps.api.createGuest(deps.deviceToken, netid, homeClub, card);

  // Spec section 8. That person already has a card, which means a replacement
  // or the wrong netID — neither is safe to guess at, and neither is a
  // network problem. Saying "could not reach the server" would send staff to
  // check the Wi-Fi for something no network fixes.
  if (!result.ok && result.status === 409) return { kind: "already-bound", netid };
  if (!result.ok) return { kind: "failed" };

  await deps.store.putPerson(result.data);
  if (card) await deps.store.addCredential(card, result.data.netid);

  return checkIn(result.data, meal.mealPeriod, at, "manual", deps);
}
