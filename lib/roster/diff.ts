import type { RosterRow } from "./parse";

export type CurrentMember = {
  netid: string;
  fullName: string;
  classYear: number | null;
  isMember: boolean;
};

export type RosterDiff = {
  add: RosterRow[];
  update: { netid: string; fullName: string; classYear: number | null; was: string }[];
  /** netIDs that stop being members. Nothing is ever deleted. */
  drop: { netid: string; fullName: string }[];
  unchanged: number;
};

/**
 * Compare an uploaded roster against the current one.
 *
 * Departures are inferred from absence, which is powerful enough to be
 * dangerous: a truncated file would read as "remove everyone". That is why
 * this only ever DESCRIBES the change — applying it is a separate, explicit
 * action, and the caller shows this to a person first.
 *
 * Nothing is ever proposed for deletion. Leaving the club sets is_member to
 * false, which keeps a departed member's swipe history attached and lets them
 * still eat here as somebody's guest.
 */
export function diffRoster(incoming: RosterRow[], current: CurrentMember[]): RosterDiff {
  const byNetid = new Map(current.map((person) => [person.netid, person]));
  const incomingIds = new Set(incoming.map((row) => row.netid));

  const add: RosterRow[] = [];
  const update: RosterDiff["update"] = [];
  let unchanged = 0;

  for (const row of incoming) {
    const existing = byNetid.get(row.netid);

    if (!existing) {
      add.push(row);
      continue;
    }

    const nameChanged = existing.fullName !== row.fullName;
    const yearChanged = existing.classYear !== row.classYear;
    // Someone returning to the club is an update, not a no-op.
    const rejoining = !existing.isMember;

    if (nameChanged || yearChanged || rejoining) {
      update.push({
        netid: row.netid,
        fullName: row.fullName,
        classYear: row.classYear,
        was: rejoining ? "rejoining the club" : existing.fullName,
      });
    } else {
      unchanged += 1;
    }
  }

  const drop = current
    // Somebody already marked as not a member must not be listed as leaving
    // again, or every upload re-drops the same people forever.
    .filter((person) => person.isMember && !incomingIds.has(person.netid))
    .map((person) => ({ netid: person.netid, fullName: person.fullName }));

  return { add, update, drop, unchanged };
}

/**
 * The share of the club this upload would remove.
 *
 * A truncated export is the realistic accident, and it would silently end
 * access for people who are still members. Past this share the interface asks
 * a second time.
 */
export const LARGE_DROP_SHARE = 1 / 3;

export function isLargeDrop(diff: RosterDiff, currentMemberCount: number): boolean {
  if (currentMemberCount === 0) return false;
  return diff.drop.length / currentMemberCount > LARGE_DROP_SHARE;
}
