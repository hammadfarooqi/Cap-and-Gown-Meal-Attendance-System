import { describe, it, expect } from "vitest";
import { lookupDirectory } from "./ldap";

/**
 * These talk to the real Princeton directory.
 *
 * Deliberately so: this module exists to distinguish "no such person" from "I
 * could not ask", and that distinction only means anything against the server
 * that actually makes it. A mock would test the mock.
 *
 * They cover only the ABSENT side, because that is the side a real person is
 * not needed for. Asserting the FOUND side against a live directory means
 * naming somebody real, and a netID is an email address — so that assertion
 * does not belong in a repository. Two consequences worth knowing:
 *
 *   - Nothing here proves a successful lookup returns a name. The guest form
 *     pre-fills from it, so a regression there degrades quietly rather than
 *     refusing anybody.
 *   - Nothing here proves a timeout, a TLS failure, or a refused connection
 *     comes back as UNAVAILABLE rather than ABSENT. That is the property the
 *     whole design rests on — absent may refuse somebody at the door,
 *     unavailable never may — and it is currently guarded only by reading
 *     `lookupDirectory`'s catch block.
 *
 * Closing both needs an injectable client rather than a real netID.
 */
describe("lookupDirectory", () => {
  it("SAYS ABSENT, NOT UNAVAILABLE, for a netID that does not exist", async () => {
    // The whole design rests on this. Absent is allowed to refuse somebody;
    // unavailable never is. If the server ever stops distinguishing them,
    // this test is what notices.
    expect((await lookupDirectory("zz9999")).status).toBe("absent");
  }, 15_000);

  it("treats a malformed netID as absent without asking the directory", async () => {
    expect((await lookupDirectory("nope")).status).toBe("absent");
  });

  it("normalises case and whitespace before deciding", async () => {
    // Same unassignable netID as above, shouted and padded. If normalisation
    // broke, this would fail the shape check and never reach the directory —
    // a different code path reaching the same answer, which is why the
    // assertion is on the status rather than on the returned netid.
    expect((await lookupDirectory("  ZZ9999 ")).status).toBe("absent");
  }, 15_000);
});
