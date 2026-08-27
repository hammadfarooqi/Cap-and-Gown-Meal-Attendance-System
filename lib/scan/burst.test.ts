import { describe, it, expect, vi, afterEach } from "vitest";
import { onScan } from "./burst";

let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  detach = undefined;
});

/** Type a string into the document, `gapMs` between each key, then Enter. */
async function type(text: string, gapMs: number) {
  for (const ch of text) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("onScan", () => {
  it("fires for a machine-speed burst ending in Enter", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("12345678901234");
  });

  it("does NOT fire for human-speed typing", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    // 80ms between keys is slower than the 50ms gap threshold, so the buffer
    // clears repeatedly and Enter arrives with at most one character.
    await type("ab1234", 80);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire for a burst shorter than the minimum token length", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("123", 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire when Enter arrives with an empty buffer", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a non-scan Enter through so a form can still submit", async () => {
    detach = onScan(vi.fn());

    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    document.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(false);
  });

  it("consumes the Enter that ends a real scan", async () => {
    detach = onScan(vi.fn());

    for (const ch of "12345678901234") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
    }
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    document.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(true);
  });

  it("ignores modifier and navigation keys inside a burst", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledWith("12345678901234");
  });

  it("recovers after a partial burst, so a stray keypress cannot poison the next scan", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    // Someone leans on a key, then walks away.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await new Promise((r) => setTimeout(r, 120));

    await type("12345678901234", 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("12345678901234");
  });

  it("fires twice for two consecutive scans", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    await type("11111111111111", 2);
    await type("22222222222222", 2);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, "11111111111111");
    expect(handler).toHaveBeenNthCalledWith(2, "22222222222222");
  });

  it("stops listening after detach", async () => {
    const handler = vi.fn();
    const stop = onScan(handler);
    stop();

    await type("12345678901234", 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it("honours overridden thresholds", async () => {
    const handler = vi.fn();
    detach = onScan(handler, { minTokenLength: 3 });

    await type("123", 2);

    expect(handler).toHaveBeenCalledWith("123");
  });

  it("ACCEPTS A REAL TIGERCARD SWIPE — 54 characters over 339 ms", async () => {
    // Measured from real hardware on 2026-08-26. The original 200 ms
    // whole-burst ceiling rejected this outright, which would have meant
    // every swipe at the door doing nothing at all.
    const handler = vi.fn();
    detach = onScan(handler);

    const card = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";
    // 6.3 ms per character is what the reader actually sent.
    await type(card, 6);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(card);
  });

  it("accepts the WORST of nine measured swipes, not just the average", async () => {
    // 342 ms across 54 characters, with a 16 ms gap somewhere in it.
    const handler = vi.fn();
    detach = onScan(handler);

    const card = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";
    for (const [i, ch] of [...card].entries()) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      // One deliberate hiccup, the largest ever observed.
      await new Promise((r) => setTimeout(r, i === 20 ? 16 : 6));
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("SURVIVES A HICCUP that would have split the burst before", async () => {
    // The gap check is destructive — one gap over the threshold and the swipe
    // silently does nothing. A tablet has more running than a laptop, so the
    // threshold sits five times above the worst measured rather than tight
    // against it.
    const handler = vi.fn();
    detach = onScan(handler);

    const card = "1234567890123456789012";
    for (const [i, ch] of [...card].entries()) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      await new Promise((r) => setTimeout(r, i === 10 ? 60 : 4));
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still refuses a burst whose average pace looks human", async () => {
    const handler = vi.fn();
    detach = onScan(handler);

    // Every gap under the 80 ms threshold, but averaging 40 ms per character
    // — far slower than any reader, and the pace check catches it.
    await type("123456789012345", 40);

    expect(handler).not.toHaveBeenCalled();
  });
});
