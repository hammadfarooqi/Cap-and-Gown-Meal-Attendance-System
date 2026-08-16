export type BurstOptions = {
  /** Shortest plausible card token. */
  minTokenLength?: number;
  /** Longest plausible whole-burst duration, first key to Enter. */
  maxBurstMs?: number;
  /** Longest plausible gap between two keys of the same burst. */
  gapMs?: number;
};

/** Starting values. Tuned against real hardware on 2026-08-30. */
export const BURST_DEFAULTS = {
  minTokenLength: 6,
  maxBurstMs: 200,
  gapMs: 50,
} as const;

/**
 * Listen for card-reader bursts anywhere on the page.
 *
 * A reader is a very fast keyboard. Rather than fight to keep a text input
 * focused — which breaks the moment anyone taps the screen — watch the whole
 * document and decide from the timing whether what arrived was a machine or a
 * person.
 *
 * When it was a person, do nothing at all and let the event reach whatever
 * had focus, so ordinary typing and the manual entry box still work.
 *
 * Testing the whole burst matters, not just testing for a non-empty buffer.
 * A human typing at 80ms per key keeps tripping the gap timer, so the buffer
 * holds only their last character when Enter arrives. Firing on that would
 * scan a single stray digit.
 *
 * @returns a function that detaches the listener.
 */
export function onScan(
  handler: (token: string) => void,
  options: BurstOptions = {},
): () => void {
  const { minTokenLength, maxBurstMs, gapMs } = { ...BURST_DEFAULTS, ...options };

  let buffer = "";
  let burstStartedAt = 0;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;

  const reset = () => {
    buffer = "";
    burstStartedAt = 0;
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = undefined;
  };

  const listener = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const elapsed = Date.now() - burstStartedAt;
      const looksLikeScan = buffer.length >= minTokenLength && elapsed <= maxBurstMs;
      const token = buffer;
      reset();

      if (looksLikeScan) {
        e.preventDefault();
        handler(token);
      }
      return;
    }

    // Modifiers, arrows and function keys report a word, not a character.
    if (e.key.length !== 1) return;

    if (buffer === "") burstStartedAt = Date.now();
    buffer += e.key;

    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = setTimeout(reset, gapMs);
  };

  document.addEventListener("keydown", listener);
  return () => {
    document.removeEventListener("keydown", listener);
    reset();
  };
}
