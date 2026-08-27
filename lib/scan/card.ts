/**
 * Read a Princeton TigerCard magnetic stripe.
 *
 * The shape of a real swipe, measured 2026-08-26, shown here with a
 * synthetic number and name:
 *
 *   %999999000000123=ALICE/BROWNING?;9999990000001238700=?
 *
 * Both tracks arrive as ONE 54-character burst — track 1 between % and ?,
 * track 2 between ; and ?. Neither number is the netID: they are card
 * numbers, which is exactly why `credentials` maps many tokens to one person
 * rather than storing an id on the person.
 *
 * Track 2's number is track 1's with four more digits ("8700"). That looks
 * like a card issue or sequence suffix, which would change when a lost card
 * is replaced while the 15-digit base stayed put — but nobody has swiped a
 * reissued card, so this does not guess. It returns BOTH numbers and lets
 * either one identify the holder. Binding stores both; whichever survives a
 * reissue keeps working, and the other simply never matches again.
 */
export type CardSwipe = {
  /** Every candidate identifier in the swipe, longest first. */
  tokens: string[];
  /** The name printed on the stripe, if the card carries one. */
  nameParts: string[];
  /** True when this looked like a card rather than typed digits. */
  isCard: boolean;
};

const TRACK_ONE = /%([^?]*)\?/;
const TRACK_TWO = /;([^?]*)\?/;

/** The digits before the field separator. */
function numberFrom(track: string | undefined): string | null {
  if (!track) return null;
  const digits = track.split("=")[0].replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

export function parseCardSwipe(raw: string): CardSwipe {
  const trackOne = TRACK_ONE.exec(raw)?.[1];
  const trackTwo = TRACK_TWO.exec(raw)?.[1];

  const numbers = [numberFrom(trackTwo), numberFrom(trackOne)]
    .filter((n): n is string => n !== null);

  // Longest first, so the most specific identifier is tried before the
  // prefix it contains.
  const tokens = [...new Set(numbers)].sort((a, b) => b.length - a.length);

  // "ALICE/BROWNING". Which half is the surname varies by issuer, so both
  // parts are kept and the member search matches on either.
  const nameParts = (trackOne?.split("=")[1] ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z][A-Za-z '.-]*$/.test(part));

  if (tokens.length > 0) return { tokens, nameParts, isCard: true };

  // Not a stripe. Someone typed an id by hand, so take it as given.
  const typed = raw.trim();
  return { tokens: typed ? [typed] : [], nameParts: [], isCard: false };
}
