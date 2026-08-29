import { Client } from "ldapts";
import { normaliseNetid } from "./netid";

/**
 * Princeton's directory, over anonymous LDAP.
 *
 * SERVER ONLY. This imports a Node socket library; importing it from a client
 * component breaks the browser bundle. The pure netID rules live in
 * `netid.ts`, which is safe on both sides.
 *
 * Measured 2026-08-29 before this was written:
 *
 *   - anonymous bind works from the open internet, no credential of any kind
 *   - reachable from a deployed Vercel function in iad1: 15ms plain, 45ms TLS
 *   - all 196 club members resolve; none is missing
 *   - an unknown netID returns error 32, distinguishable from a failure
 *
 * That last property is the whole design. "No such person" and "I could not
 * ask" must never be confused, because one of them is allowed to refuse
 * somebody at the door and the other is not.
 */

const URL = "ldaps://ldap.princeton.edu:636";
const BASE = "o=Princeton University,c=US";
const NO_SUCH_OBJECT = 32;

/** Well inside spec A6's three-second budget for the whole guest operation. */
const TIMEOUT_MS = 2000;

export type DirectoryLookup =
  /** The directory knows them. */
  | { status: "found"; netid: string; fullName: string }
  /** The directory is certain there is no such netID. Safe to refuse. */
  | { status: "absent" }
  /** We could not ask — down, slow, or offline. NEVER refuse on this. */
  | { status: "unavailable" };

/** `displayName` is "Hammad A. Farooqi"; `pudisplayname` is "Farooqi, Hammad A." */
function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || null;
  return null;
}

/**
 * Look one netID up.
 *
 * Never throws. Every failure that is not a definite "no such person" comes
 * back as `unavailable`, so a caller cannot accidentally turn a network
 * problem into a refusal.
 */
export async function lookupDirectory(rawNetid: string): Promise<DirectoryLookup> {
  const netid = normaliseNetid(rawNetid);
  // Not a netID at all. The directory would say absent, and so do we, without
  // troubling it — this is the shape check, not a lookup.
  if (!netid) return { status: "absent" };

  const client = new Client({
    url: URL,
    timeout: TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
  });

  try {
    // Anonymous. There is no credential to hold, rotate, or leak.
    await client.bind("", "");

    const { searchEntries } = await client.search(`uid=${netid},${BASE}`, {
      scope: "base",
      filter: "(objectclass=*)",
      attributes: ["displayName", "pudisplayname"],
    });

    const entry = searchEntries[0];
    if (!entry) return { status: "absent" };

    const fullName = firstString(entry.displayName);
    // Present but nameless is not a failure to reach the directory, and it is
    // not grounds to refuse anybody either.
    if (!fullName) return { status: "unavailable" };

    return { status: "found", netid, fullName };
  } catch (error) {
    // Error 32 is the server saying, definitively, that no such entry exists.
    // Everything else — timeout, DNS, TLS, a refused connection — is us being
    // unable to ask.
    const code = (error as { code?: number })?.code;
    return code === NO_SUCH_OBJECT ? { status: "absent" } : { status: "unavailable" };
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Look several up at once, for the roster upload.
 *
 * Bounded concurrency because a roster is ~200 rows: sequentially that is ten
 * seconds and a dead serverless function, and unbounded it is 200 sockets
 * opened at a university directory in one breath. Anything that fails is
 * simply absent from the result — a roster upload must never fail because a
 * directory was slow.
 */
export async function lookupMany(
  netids: string[],
  concurrency = 12,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queue = [...netids];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      const result = await lookupDirectory(next).catch(
        () => ({ status: "unavailable" }) as DirectoryLookup,
      );
      if (result.status === "found") found.set(result.netid, result.fullName);
    }
  });

  await Promise.all(workers);
  return found;
}
