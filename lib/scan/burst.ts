export type BurstOptions = {
  /** Shortest plausible card burst. */
  minTokenLength?: number;
  /** Ceiling on the AVERAGE time per character across the burst. */
  maxMsPerChar?: number;
  /** Longest plausible gap between two keys of the same burst. */
  gapMs?: number;
};

/**
 * Measured, not guessed. A real Princeton TigerCard through a real
 * magnetic-stripe reader on 2026-08-26 produced:
 *
 *   54 characters · 339 ms total · 10 ms largest gap · 1 Enter
 *
 * The first version of this capped the WHOLE burst at 200 ms, which was set
 * when the card was assumed to be a ~14-digit barcode. A TigerCard sends both
 * tracks in one 54-character burst, so every real swipe would have been
 * silently ignored. That is the bug /station/reader-check existed to find.
 *
 * The ceiling is now per character, so it scales with the length of whatever
 * the reader sends rather than assuming one. Measured 6.3 ms/char against a
 * 25 ms limit is four times the margin, and 25 ms/char is a tighter average
 * than the 50 ms gap allows — it also catches a burst where every gap sits
 * just under the threshold, which sustained fast typing would look like.
 *
 * The gap does the real discriminating: 10 ms measured against 50 ms is five
 * times the margin, and no person types fifteen characters with every gap
 * under 50 ms.
 */
export const BURST_DEFAULTS = {
  minTokenLength: 10,
  maxMsPerChar: 25,
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
  const { minTokenLength, maxMsPerChar, gapMs } = { ...BURST_DEFAULTS, ...options };

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
      const looksLikeScan =
        buffer.length >= minTokenLength && elapsed <= buffer.length * maxMsPerChar;
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
