import { describe, it, expect } from "vitest";
import { parseCardSwipe } from "./card";

/** Captured from a real Princeton TigerCard on 2026-08-26. */
const REAL_SWIPE = "%601621920380463=HAMMAD/FAROOQI?;6016219203804638700=?";

describe("parseCardSwipe", () => {
  it("reads both numbers out of a real swipe", () => {
    const swipe = parseCardSwipe(REAL_SWIPE);

    expect(swipe.isCard).toBe(true);
    expect(swipe.tokens).toEqual(["6016219203804638700", "601621920380463"]);
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
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toEqual(["HAMMAD", "FAROOQI"]);
  });

  it("keeps both name parts, because issuers disagree on the order", () => {
    expect(parseCardSwipe(REAL_SWIPE).nameParts).toHaveLength(2);
  });

  it("copes with track 2 alone, which some readers emit", () => {
    const swipe = parseCardSwipe(";6016219203804638700=?");

    expect(swipe.isCard).toBe(true);
    expect(swipe.tokens).toEqual(["6016219203804638700"]);
    expect(swipe.nameParts).toEqual([]);
  });

  it("copes with track 1 alone", () => {
    const swipe = parseCardSwipe("%601621920380463=HAMMAD/FAROOQI?");

    expect(swipe.tokens).toEqual(["601621920380463"]);
    expect(swipe.nameParts).toEqual(["HAMMAD", "FAROOQI"]);
  });

  it("does not return the same number twice when the tracks agree", () => {
    const swipe = parseCardSwipe("%601621920380463=X/Y?;601621920380463=?");
    expect(swipe.tokens).toEqual(["601621920380463"]);
  });

  it("TREATS A TYPED ID AS ITSELF, not as a stripe", () => {
    // Manual entry runs through the same path; there are no sentinels to
    // strip and nothing to infer.
    const swipe = parseCardSwipe("hf4888");

    expect(swipe.isCard).toBe(false);
    expect(swipe.tokens).toEqual(["hf4888"]);
  });

  it("trims a typed id", () => {
    expect(parseCardSwipe("  hf4888  ").tokens).toEqual(["hf4888"]);
  });

  it("returns nothing for an empty swipe", () => {
    expect(parseCardSwipe("").tokens).toEqual([]);
  });

  it("ignores a stripe with no readable number", () => {
    const swipe = parseCardSwipe("%=BROKEN/READ?;=?");
    expect(swipe.isCard).toBe(false);
  });
});
