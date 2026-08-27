import { describe, it, expect } from "vitest";
import { nameCandidates, namesMatch, nameChunks } from "./name-match";

/**
 * Synthetic people, NOT the club's roster.
 *
 * Every shape here is one the real roster actually contains — two identical
 * full names, a surname shared four ways, an apostrophe, an accent, two
 * hyphenated surnames, a four-word double surname and a middle name — but the
 * names and netIDs are invented. A netID is an email address, and git history
 * is permanent.
 */
const ROSTER = [
  { netid: "aa1001", fullName: "Hamid Farrow" },
  { netid: "rh1000", fullName: "Robin Hale" },
  { netid: "rh1001", fullName: "Robin Hale" },
  { netid: "aw2001", fullName: "Alice Ward" },
  { netid: "bw2002", fullName: "Brian Ward" },
  { netid: "cw2003", fullName: "Cara Ward" },
  { netid: "dw2004", fullName: "Dana Ward" },
  { netid: "vd3001", fullName: "Vincent D'Amico" },
  { netid: "rd3002", fullName: "Renée Dubois" },
  { netid: "lh4001", fullName: "Lily Harper-Stone" },
  { netid: "la4002", fullName: "Leila Ashworth-Vance" },
  { netid: "mg5001", fullName: "Manuel Garcia San Pablo" },
  { netid: "ew6001", fullName: "Emma May Whitfield" },
];

const netids = (parts: string[]) => nameCandidates(parts, ROSTER).map((p) => p.netid);

describe("nameCandidates", () => {
  it("finds the one member a card names", () => {
    expect(netids(["HAMID", "FARROW"])).toEqual(["aa1001"]);
  });

  it("RETURNS BOTH PEOPLE WHO SHARE A NAME, because a name is not an identity", () => {
    // The case the whole design exists for. Two real members share a full
    // name, so the matcher must never pick one of them itself.
    expect(netids(["ROBIN", "HALE"])).toEqual(["rh1000", "rh1001"]);
  });

  it("KEEPS THE FOUR WARDS APART on one shared chunk", () => {
    // A surname alone must never be a match, or a rush turns into a
    // four-way pick every time somebody with that surname swipes.
    expect(netids(["ALICE", "WARD"])).toEqual(["aw2001"]);
    expect(netids(["BRIAN", "WARD"])).toEqual(["bw2002"]);
  });

  it("does not care whether the card sends FIRST/LAST or LAST/FIRST", () => {
    // We hold exactly one real card and cannot know which order it uses.
    expect(netids(["FARROW", "HAMID"])).toEqual(["aa1001"]);
  });

  it("REFUSES A RELATIVE who shares a hyphenated surname", () => {
    // A flat bag of words let the surname supply two shared words on its
    // own, so this matched Lily Harper-Stone. Chunks require the first name
    // to agree too.
    expect(netids(["ANNA", "HARPER-STONE"])).toEqual([]);
    expect(netids(["LILY", "HARPER-STONE"])).toEqual(["lh4001"]);
  });

  it("matches a hyphenated surname written without its hyphen", () => {
    expect(netids(["LILY", "HARPERSTONE"])).toEqual(["lh4001"]);
    expect(netids(["LEILA", "ASHWORTHVANCE"])).toEqual(["la4002"]);
  });

  it("matches through an apostrophe and through an accent", () => {
    expect(netids(["VINCENT", "DAMICO"])).toEqual(["vd3001"]);
    expect(netids(["VINCENT", "D'AMICO"])).toEqual(["vd3001"]);
    expect(netids(["RENEE", "DUBOIS"])).toEqual(["rd3002"]);
  });

  it("tolerates a middle name the card omits", () => {
    expect(netids(["EMMA", "WHITFIELD"])).toEqual(["ew6001"]);
  });

  it("tolerates a middle name the card adds and the roster lacks", () => {
    // The direction we are blind in: nobody has seen a card carrying one.
    expect(netids(["HAMID", "ALI", "FARROW"])).toEqual(["aa1001"]);
  });

  it("handles a four-word double surname", () => {
    expect(netids(["MANUEL", "GARCIA"])).toEqual(["mg5001"]);
    expect(netids(["MANUEL", "SAN", "PABLO"])).toEqual(["mg5001"]);
  });

  it("NEVER MATCHES ON A SINGLE CHUNK", () => {
    // A truncated stripe must fall through to the guest form, not bind
    // somebody at random.
    expect(netids(["WARD"])).toEqual([]);
    expect(netids(["FARROW"])).toEqual([]);
    expect(netids([])).toEqual([]);
  });

  it("ignores one-letter chunks, which are middle initials", () => {
    expect(netids(["EMMA", "M", "WHITFIELD"])).toEqual(["ew6001"]);
  });

  it("returns nothing for a name nobody has", () => {
    expect(netids(["JOHN", "SMITH"])).toEqual([]);
  });
});

describe("namesMatch", () => {
  it("agrees with nameCandidates for a single person", () => {
    expect(namesMatch(["HAMID", "FARROW"], "Hamid Farrow")).toBe(true);
    expect(namesMatch(["HAMID", "FARROW"], "Robin Hale")).toBe(false);
  });
});

describe("nameChunks", () => {
  it("gives a hyphenated chunk both its joined and split forms", () => {
    const [, surname] = nameChunks("Lily Harper-Stone");
    expect(surname).toEqual(new Set(["HARPERSTONE", "HARPER", "STONE"]));
  });

  it("drops empty chunks from doubled spaces", () => {
    expect(nameChunks("Robin   Hale")).toHaveLength(2);
  });
});
