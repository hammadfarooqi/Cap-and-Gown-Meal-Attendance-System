import { describe, it, expect } from "vitest";
import { netidFromFilename } from "./naming";

describe("netidFromFilename", () => {
  it.each([
    ["hf4888.jpg", "hf4888"],
    ["hf4888.JPEG", "hf4888"],
    ["HF4888.png", "hf4888"],
    ["hf4888.webp", "hf4888"],
  ])("matches %s to %s", (filename, netid) => {
    expect(netidFromFilename(filename)).toBe(netid);
  });

  it.each([
    ["hf4888 - Hammad Farooqi.jpg", "hf4888"],
    ["hf4888_headshot.png", "hf4888"],
    ["hf4888-2026.jpg", "hf4888"],
  ])("matches %s when the netID leads the name", (filename, netid) => {
    expect(netidFromFilename(filename)).toBe(netid);
  });

  it.each([
    "IMG_4471.jpg",
    "Hammad Farooqi.jpg",
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
    expect(netidFromFilename("hf4888.jpg")).toBe("hf4888");
  });
});
