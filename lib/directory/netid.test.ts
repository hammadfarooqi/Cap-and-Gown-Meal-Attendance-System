import { describe, it, expect } from "vitest";
import { isValidNetid, normaliseNetid } from "./netid";

describe("isValidNetid", () => {
  it.each(["ab1234", "zz9999", "hl7165"])("accepts %s", (n) => {
    expect(isValidNetid(n)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["a", "too short"],
    ["4888hf", "starts with a digit"],
    ["hf 4888", "contains a space"],
    ["hf-4888", "contains punctuation"],
    ["ab1234@princeton.edu", "an email, not a netID"],
    ["averyveryverylongnetid", "too long"],
    ["ab12", "too few digits"],
    ["ab12345", "too many digits"],
    ["a1234", "one letter"],
    ["abc1234", "three letters"],
    ["abcdef", "no digits"],
    ["123456", "no letters"],
  ])("rejects %s (%s)", (n) => {
    expect(isValidNetid(n)).toBe(false);
  });

  it("accepts a netID typed in capitals", () => {
    expect(isValidNetid("AB1234")).toBe(true);
  });
});

describe("normaliseNetid", () => {
  it("trims and lowercases", () => {
    expect(normaliseNetid("  AB1234 ")).toBe("ab1234");
  });

  it("returns null for anything that is not a netID", () => {
    expect(normaliseNetid("not a netid")).toBeNull();
    expect(normaliseNetid("abc123")).toBeNull();
  });
});
