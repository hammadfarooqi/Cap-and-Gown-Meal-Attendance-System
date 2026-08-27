import { describe, it, expect } from "vitest";
import { parseCardSwipe } from "./card";

/**
 * The exact shape of a real TigerCard swipe — 54 characters, both tracks,
 * track 2 being track 1 plus a four-digit suffix — with a synthetic number
 * and name. The shape is what these tests verify; the digits are nobody's.
 */
const REAL_SWIPE = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";

describe("parseCardSwipe", () => {
  it("TAKES TRACK 1'S 15-DIGIT NUMBER, not track 2's 19", () => {
    // Track 2 is track 1 plus a four-digit suffix with the shape of a card
    // issue number. Binding the base is the bet that the base survives a
    // reissue and the suffix is what changes.
    const swipe = parseCardSwipe(REAL_SWIPE);

    expect(swipe.isCard).toBe(true);
    expect(swipe.token).toBe("999999000000123");
  });

  it("READS THE NAME OFF THE STRIPE", () => {
    // Worth a great deal on the first day: 196 people each need binding
    // once, and the card already says who they are.
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toEqual(["ALICE", "BROWNING"]);
  });

  it("keeps both name parts, because issuers disagree on the order", () => {
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toHaveLength(2);
  });

  it("TRIMS THE SUFFIX when only track 2 is read", () => {
    // Some readers emit track 2 alone. Storing the 19-digit number would file
    // the same physical card under a different token than a track-1 read of
    // it, so the assumed four-digit suffix comes back off.
    const swipe = parseCardSwipe(";9999990000001238700=?");

    expect(swipe.isCard).toBe(true);
    expect(swipe.token).toBe("999999000000123");
    expect(swipe.nameParts).toEqual([]);
  });

  it("copes with track 1 alone", () => {
    const swipe = parseCardSwipe("%999999000000123=ALICE/BROWNING?");

    expect(swipe.token).toBe("999999000000123");
    expect(swipe.nameParts).toEqual(["ALICE", "BROWNING"]);
  });

  it("READS THE SAME TOKEN FROM EITHER TRACK, so one card is one row", () => {
    // The whole point of trimming the suffix: a track-1 read and a track-2
    // read of one card must agree, or the person gets bound twice.
    expect(parseCardSwipe(REAL_SWIPE).token).toBe(
      parseCardSwipe(";9999990000001238700=?").token,
    );
  });

  it("TREATS A TYPED ID AS ITSELF, not as a stripe", () => {
    // Manual entry runs through the same path; there are no sentinels to
    // strip and nothing to infer.
    const swipe = parseCardSwipe("ab1234");

    expect(swipe.isCard).toBe(false);
    expect(swipe.token).toBe("ab1234");
  });

  it("trims a typed id", () => {
    expect(parseCardSwipe("  ab1234  ").token).toBe("ab1234");
  });

  it("returns nothing for an empty swipe", () => {
    expect(parseCardSwipe("").token).toBeNull();
  });

  it("ignores a stripe with no readable number", () => {
    const swipe = parseCardSwipe("%=BROKEN/READ?;=?");
    expect(swipe.isCard).toBe(false);
  });
});
