import { describe, it, expect } from "vitest";
import { isValidNetid, lookupNetid } from "./lookup";

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

describe("lookupNetid", () => {
  it("normalises case and whitespace", async () => {
    expect(await lookupNetid("  AB1234 ")).toEqual({ netid: "ab1234", fullName: null });
  });

  it("returns null for something that is not a netID", async () => {
    expect(await lookupNetid("not a netid")).toBeNull();
  });

  it("returns a null name while the real directory is unresolved (O2)", async () => {
    // When O2 closes, this test changes and the guest ledger gains names.
    // Until then it documents that a null name is expected, not a bug.
    expect((await lookupNetid("ab1234"))!.fullName).toBeNull();
  });
});
