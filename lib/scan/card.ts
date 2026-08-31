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
 * NOT every card is the same length. Four real cards, measured 2026-08-31:
 * three were 15 digits behind one issuer prefix, a fourth was 17 behind a
 * different one. Nothing here assumes a length — the token is whatever track 1
 * says, which is stable per card and that is all binding needs.
 *
 * Track 2's number is track 1's with four more digits ("8700"). That has the
 * shape of a card issue or sequence suffix, which would change when a lost
 * card is replaced while the 15-digit base stayed put. Nobody has swiped a
 * reissued card, so that is a bet rather than a measurement — but it is the
 * bet this makes: the 15-digit base IS the card, one token, one row.
 *
 * If the bet is backwards and a reissue changes the base instead, the
 * replacement card simply does not resolve and lands in the officer path.
 * Loud rather than silent, which is the right way round for a guess nobody
 * can test without a reissued card in hand.
 */
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

  const one = numberFrom(trackOne);
  const two = numberFrom(trackTwo);

  // Track 1's number is the base. When only track 2 is read, the assumed
  // suffix comes back off, so both reads of one card produce one token.
  const token =
    one ??
    (two && two.length > ISSUE_SUFFIX_LENGTH
      ? two.slice(0, two.length - ISSUE_SUFFIX_LENGTH)
      : two);

  // "ALICE/BROWNING". Which half is the surname varies by issuer, so both
  // parts are kept and the matcher compares them as an unordered set.
  const nameParts = (trackOne?.split("=")[1] ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z][A-Za-z '.-]*$/.test(part));

  if (token) return { token, nameParts, isCard: true };

  // Not a stripe. Someone typed an id by hand, so take it as given.
  const typed = raw.trim();
  return { token: typed || null, nameParts: [], isCard: false };
}
