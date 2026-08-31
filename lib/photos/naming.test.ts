import { describe, it, expect } from "vitest";
import { netidFromFilename, PHOTO_WIDTH, PHOTO_HEIGHT } from "./naming";

describe("netidFromFilename", () => {
  it.each([
    ["ab1234.jpg", "ab1234"],
    ["ab1234.JPEG", "ab1234"],
    ["AB1234.png", "ab1234"],
    ["ab1234.webp", "ab1234"],
  ])("matches %s to %s", (filename, netid) => {
    expect(netidFromFilename(filename)).toBe(netid);
  });

  it.each([
    ["ab1234 - Alice Browning.jpg", "ab1234"],
    ["ab1234_headshot.png", "ab1234"],
    ["ab1234-2026.jpg", "ab1234"],
  ])("matches %s when the netID leads the name", (filename, netid) => {
    expect(netidFromFilename(filename)).toBe(netid);
  });

  it.each([
    "IMG_4471.jpg",
    "Alice Browning.jpg",
    "headshot.png",
    "2026 roster photo.jpg",
  ])("REPORTS %s rather than guessing", (filename) => {
    // A wrong guess puts somebody else's face on a student's check-in screen.
    expect(netidFromFilename(filename)).toBeNull();
  });

  it("does not match a bare number", () => {
    expect(netidFromFilename("4471.jpg")).toBeNull();
  });

  it("REQUIRES A DIGIT, so a word is never mistaken for a netID", () => {
    // Every one of the club's 196 real netIDs contains digits. Without this,
    // "IMG_4471.jpg" matches "img" and "headshot.png" matches "headshot",
    // and the wrong face ends up on somebody's check-in screen.
    expect(netidFromFilename("img_4471.jpg")).toBeNull();
    expect(netidFromFilename("photo.jpg")).toBeNull();
    expect(netidFromFilename("ab1234.jpg")).toBe("ab1234");
  });
});

describe("the headshot shape", () => {
  it("IS A 4:5 PORTRAIT, not a square", () => {
    // The club's originals are 857x1200. Squaring a portrait cropped 171px
    // off the top, which in a posed headshot is the top of somebody's head.
    // If this ever goes back to a square, that returns with it.
    expect(PHOTO_WIDTH / PHOTO_HEIGHT).toBeCloseTo(0.8, 5);
    expect(PHOTO_WIDTH).toBeLessThan(PHOTO_HEIGHT);
  });
});
