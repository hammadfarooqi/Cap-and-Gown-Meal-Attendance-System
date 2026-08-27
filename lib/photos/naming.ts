import { isValidNetid } from "@/lib/directory/lookup";

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
 * isValidNetid itself stays permissive, because a guest may type an older
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

/** 400x400 WebP at roughly this size keeps a 300-member set near 12MB. */
export const PHOTO_EDGE = 400;
export const PHOTO_QUALITY = 0.82;
