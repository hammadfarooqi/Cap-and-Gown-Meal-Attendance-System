import { describe, it, expect } from "vitest";
import { diffRoster, isLargeDrop, type CurrentMember } from "./diff";
import type { RosterRow } from "./parse";

const member = (netid: string, fullName: string, over: Partial<CurrentMember> = {}): CurrentMember => ({
  netid, fullName, classYear: 2028, isMember: true, ...over,
});

const row = (netid: string, fullName: string, classYear: number | null = 2028): RosterRow => ({
  netid, fullName, classYear,
});

describe("diffRoster", () => {
  it("adds someone who is not in the roster yet", () => {
    const diff = diffRoster([row("new1234", "New Person")], []);

    expect(diff.add).toHaveLength(1);
    expect(diff.add[0].netid).toBe("new1234");
  });

  it("reports a corrected name as an update", () => {
    const diff = diffRoster(
      [row("aa1111", "Alice Anderson")],
      [member("aa1111", "Alise Anderson")],
    );

    expect(diff.update).toHaveLength(1);
    expect(diff.update[0].was).toBe("Alise Anderson");
  });

  it("reports a changed class year as an update", () => {
    const diff = diffRoster(
      [row("aa1111", "Alice Anderson", 2027)],
      [member("aa1111", "Alice Anderson", { classYear: 2028 })],
    );

    expect(diff.update).toHaveLength(1);
  });

  it("leaves an identical row alone", () => {
    const diff = diffRoster(
      [row("aa1111", "Alice Anderson")],
      [member("aa1111", "Alice Anderson")],
    );

    expect(diff.update).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it("treats somebody rejoining as an update, not a no-op", () => {
    const diff = diffRoster(
      [row("aa1111", "Alice Anderson")],
      [member("aa1111", "Alice Anderson", { isMember: false })],
    );

    expect(diff.update).toHaveLength(1);
    expect(diff.update[0].was).toBe("rejoining the club");
  });

  it("drops a member who is absent from the file", () => {
    const diff = diffRoster([], [member("gone1234", "Departing Senior")]);

    expect(diff.drop).toEqual([{ netid: "gone1234", fullName: "Departing Senior" }]);
  });

  it("DOES NOT RE-DROP SOMEONE WHO ALREADY LEFT", () => {
    // Otherwise every upload lists the same departures forever, and the
    // large-drop warning fires on a file that changes nothing.
    const diff = diffRoster([], [member("gone1234", "Already Gone", { isMember: false })]);

    expect(diff.drop).toEqual([]);
  });

  it("NEVER PROPOSES A DELETION", () => {
    // Leaving the club sets is_member false. Deleting would take their swipe
    // history with them and stop them eating here as a guest.
    const diff = diffRoster([], [member("gone1234", "Departing Senior")]);

    expect(Object.keys(diff)).toEqual(["add", "update", "drop", "unchanged"]);
    expect(diff.drop[0]).not.toHaveProperty("delete");
  });

  it("handles a whole class turning over", () => {
    const diff = diffRoster(
      [row("new1", "New One"), row("new2", "New Two")],
      [member("old1", "Old One"), member("old2", "Old Two")],
    );

    expect(diff.add).toHaveLength(2);
    expect(diff.drop).toHaveLength(2);
    expect(diff.unchanged).toBe(0);
  });
});

describe("isLargeDrop", () => {
  const dropping = (count: number) => ({
    add: [], update: [], unchanged: 0,
    drop: Array.from({ length: count }, (_, i) => ({ netid: `x${i}`, fullName: `X ${i}` })),
  });

  it("FLAGS A FILE THAT WOULD REMOVE MOST OF THE CLUB", () => {
    // A truncated export is the realistic accident, and it would silently end
    // access for people who are still members.
    expect(isLargeDrop(dropping(100), 196)).toBe(true);
  });

  it("does not flag ordinary end-of-year turnover", () => {
    // Roughly a quarter of a 196-person club graduating is normal.
    expect(isLargeDrop(dropping(50), 196)).toBe(false);
  });

  it("does not flag an empty roster, which has nothing to lose", () => {
    expect(isLargeDrop(dropping(0), 0)).toBe(false);
  });
});
