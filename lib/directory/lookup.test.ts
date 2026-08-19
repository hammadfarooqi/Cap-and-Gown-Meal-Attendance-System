import { describe, it, expect } from "vitest";
import { isValidNetid, lookupNetid } from "./lookup";

describe("isValidNetid", () => {
  it.each(["hf4888", "ab12", "zz9"])("accepts %s", (n) => {
    expect(isValidNetid(n)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["a", "too short"],
    ["4888hf", "starts with a digit"],
    ["hf 4888", "contains a space"],
    ["hf-4888", "contains punctuation"],
    ["hf4888@princeton.edu", "an email, not a netID"],
    ["averyveryverylongnetid", "too long"],
  ])("rejects %s (%s)", (n) => {
    expect(isValidNetid(n)).toBe(false);
  });

  it("accepts a netID typed in capitals", () => {
    expect(isValidNetid("HF4888")).toBe(true);
  });
});

describe("lookupNetid", () => {
  it("normalises case and whitespace", async () => {
    expect(await lookupNetid("  HF4888 ")).toEqual({ netid: "hf4888", fullName: null });
  });

  it("returns null for something that is not a netID", async () => {
    expect(await lookupNetid("not a netid")).toBeNull();
  });

  it("returns a null name while the real directory is unresolved (O2)", async () => {
    // When O2 closes, this test changes and the guest ledger gains names.
    // Until then it documents that a null name is expected, not a bug.
    expect((await lookupNetid("hf4888"))!.fullName).toBeNull();
  });
});
