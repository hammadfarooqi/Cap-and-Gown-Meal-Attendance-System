export type DirectoryPerson = { netid: string; fullName: string | null };

/**
 * Two letters then four digits. Nothing else.
 *
 * This was deliberately permissive until 2026-08-29, on the reasoning that a
 * typed netID has a human watching it. On-site testing changed the call: a
 * mistyped netID does not fail, it silently invents a person, records a meal
 * against them, and can never be told apart from a real guest afterwards.
 *
 * Measured against the real roster before tightening: all 196 members match
 * this shape, with no exceptions.
 */
const NETID_SHAPE = /^[a-z]{2}[0-9]{4}$/;

export function isValidNetid(netid: string): boolean {
  return NETID_SHAPE.test(netid.trim().toLowerCase());
}

/**
 * Resolve a netID to a person.
 *
 * STUB — open question O2. TigerBook and Princeton LDAP are both candidates,
 * and neither has been shown to work from a Vercel function; LDAP in
 * particular may require the campus network.
 *
 * Until that closes, this validates the shape and returns a null name. Every
 * guest flow works; guests simply show as their netID until the real lookup
 * lands. Swapping this one module is the whole change.
 */
export async function lookupNetid(netid: string): Promise<DirectoryPerson | null> {
  const normalised = netid.trim().toLowerCase();
  if (!isValidNetid(normalised)) return null;
  return { netid: normalised, fullName: null };
}
