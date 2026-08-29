import { describe, it, expect } from "vitest";
import { lookupDirectory } from "./ldap";

/**
 * These talk to the real Princeton directory.
 *
 * Deliberately so: this module exists to distinguish "no such person" from "I
 * could not ask", and that distinction only means anything against the server
 * that actually makes it. A mock would test the mock. They are few, they read
 * only name fields, and one uses the operator's own netID.
 */
describe("lookupDirectory", () => {
  it("finds a real netID", async () => {
    const result = await lookupDirectory("hf4888");
    expect(result.status).toBe("found");
    expect(result.status === "found" && result.fullName.length).toBeGreaterThan(0);
  }, 15_000);

  it("SAYS ABSENT, NOT UNAVAILABLE, for a netID that does not exist", async () => {
    // The whole design rests on this. Absent is allowed to refuse somebody;
    // unavailable never is. If the server ever stops distinguishing them,
    // this test is what notices.
    expect((await lookupDirectory("zz9999")).status).toBe("absent");
  }, 15_000);

  it("treats a malformed netID as absent without asking the directory", async () => {
    expect((await lookupDirectory("nope")).status).toBe("absent");
  });

  it("normalises case and whitespace", async () => {
    const result = await lookupDirectory("  HF4888 ");
    expect(result.status === "found" && result.netid).toBe("hf4888");
  }, 15_000);
});
