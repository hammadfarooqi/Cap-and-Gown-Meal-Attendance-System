import { isValidNetid } from "@/lib/directory/netid";

/**
 * Work out who a photo file belongs to.
 *
 * Open question O6 is still open — nobody has said how the club's export
 * names its files — so this handles what is likely rather than assuming.
 * A file named for a netID matches itself. Anything else is reported for a
 * human to assign, never guessed at and never silently dropped: a wrong
 * guess puts somebody else's face on a student's check-in screen.
 */
/**
 * Deliberately stricter than isValidNetid.
 *
 * Validating a netID somebody typed is one thing; guessing a person from a
 * filename is another, and a wrong guess is silent. Every one of the club's
 * 196 real netIDs contains digits, so requiring one rejects "IMG_4471"
 * matching "img" and "headshot.png" matching "headshot" — both of which the
 * looser rule accepted.
 *
 * isValidNetid is now strict too, but this keeps its own digit check because
 * letters-only netID and that path has a human watching.
 */
function looksLikeANetid(candidate: string): boolean {
  return isValidNetid(candidate) && /[0-9]/.test(candidate);
}

export function netidFromFilename(filename: string): string | null {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .toLowerCase();

  if (looksLikeANetid(base)) return base;

  // "ab1234 - Alice Browning.jpg", "ab1234_headshot.png"
  const leading = /^([a-z][a-z0-9]{1,15})[\s._-]/.exec(base)?.[1];
  if (leading && looksLikeANetid(leading)) return leading;

  return null;
}

/**
 * 400x500 WebP — a 4:5 portrait, not a square.
 *
 * The club's headshots arrive 857x1200. A square crop of a portrait throws
 * away a fifth of the frame from the top and another fifth from the bottom,
 * and in a posed headshot the head sits high, so the top of it goes. Keeping
 * the portrait shape keeps the whole head and makes the face fill more of
 * whatever it is drawn into.
 *
 * At this size a 300-member set is still comfortably under 12MB.
 */
export const PHOTO_WIDTH = 400;
export const PHOTO_HEIGHT = 500;
export const PHOTO_QUALITY = 0.82;
