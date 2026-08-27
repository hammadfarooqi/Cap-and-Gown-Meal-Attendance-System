import { describe, it, expect } from "vitest";
import { parseCardSwipe } from "./card";

/**
 * The exact shape of a real TigerCard swipe — 54 characters, both tracks,
 * track 2 being track 1 plus a four-digit suffix — with a synthetic number
 * and name. The shape is what these tests verify; the digits are nobody's.
 */
const REAL_SWIPE = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";

describe("parseCardSwipe", () => {
  it("reads both numbers out of a real swipe", () => {
    const swipe = parseCardSwipe(REAL_SWIPE);

    expect(swipe.isCard).toBe(true);
    expect(swipe.tokens).toEqual(["9999990000001238700", "999999000000123"]);
  });

  it("PUTS THE LONGER NUMBER FIRST, so the prefix is not preferred to it", () => {
    // Track 1's number is a prefix of track 2's. Matching the prefix first
    // would make the two cards indistinguishable if they ever differed.
    const [first, second] = parseCardSwipe(REAL_SWIPE).tokens;
    expect(first.length).toBeGreaterThan(second.length);
    expect(first.startsWith(second)).toBe(true);
  });

  it("READS THE NAME OFF THE STRIPE", () => {
    // Worth a great deal on the first day: 196 people each need binding
    // once, and the card already says who they are.
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toEqual(["ALICE", "BROWNING"]);
  });

  it("keeps both name parts, because issuers disagree on the order", () => {
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toHaveLength(2);
  });

  it("copes with track 2 alone, which some readers emit", () => {
    const swipe = parseCardSwipe(";9999990000001238700=?");

    expect(swipe.isCard).toBe(true);
    expect(swipe.tokens).toEqual(["9999990000001238700"]);
    expect(swipe.nameParts).toEqual([]);
  });

  it("copes with track 1 alone", () => {
    const swipe = parseCardSwipe("%999999000000123=ALICE/BROWNING?");

    expect(swipe.tokens).toEqual(["999999000000123"]);
    expect(swipe.nameParts).toEqual(["ALICE", "BROWNING"]);
  });

  it("does not return the same number twice when the tracks agree", () => {
    const swipe = parseCardSwipe("%999999000000123=X/Y?;999999000000123=?");
    expect(swipe.tokens).toEqual(["999999000000123"]);
  });

  it("TREATS A TYPED ID AS ITSELF, not as a stripe", () => {
    // Manual entry runs through the same path; there are no sentinels to
    // strip and nothing to infer.
    const swipe = parseCardSwipe("ab1234");

    expect(swipe.isCard).toBe(false);
    expect(swipe.tokens).toEqual(["ab1234"]);
  });

  it("trims a typed id", () => {
    expect(parseCardSwipe("  ab1234  ").tokens).toEqual(["ab1234"]);
  });

  it("returns nothing for an empty swipe", () => {
    expect(parseCardSwipe("").tokens).toEqual([]);
  });

  it("ignores a stripe with no readable number", () => {
    const swipe = parseCardSwipe("%=BROKEN/READ?;=?");
    expect(swipe.isCard).toBe(false);
  });
});
