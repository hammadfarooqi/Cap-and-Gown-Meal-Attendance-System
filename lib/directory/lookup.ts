export type DirectoryPerson = { netid: string; fullName: string | null };

/**
 * Princeton netIDs are lowercase alphanumeric and start with a letter. The
 * exact rule is not documented publicly, so this is deliberately permissive —
 * it exists to reject obvious typos and pasted junk, not to be an authority.
 */
const NETID_SHAPE = /^[a-z][a-z0-9]{1,15}$/;

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
