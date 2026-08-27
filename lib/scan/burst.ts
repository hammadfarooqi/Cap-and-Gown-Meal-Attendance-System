export type BurstOptions = {
  /** Shortest plausible card burst. */
  minTokenLength?: number;
  /** Ceiling on the AVERAGE time per character across the burst. */
  maxMsPerChar?: number;
  /** Longest plausible gap between two keys of the same burst. */
  gapMs?: number;
};

/**
 * Measured, not guessed. Nine swipes of a real Princeton TigerCard through a
 * real magnetic-stripe reader on 2026-08-26:
 *
 *   54 characters every time · 1 Enter every time
 *   total time  337-342 ms   (1.5% spread — very stable)
 *   largest gap   9-16 ms    (78% spread — the jumpy one)
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
 * THE TWO CHECKS DO DIFFERENT JOBS, which is why they are tuned differently.
 *
 * The per-character pace is what rejects a human. Nobody sustains 25 ms per
 * keystroke over ten characters; the fastest typists sit near 100 ms. It is
 * also the stable measurement — 6.33 ms worst case across nine swipes, a
 * spread of 1.5%.
 *
 * The gap's job is to throw away a stray keypress so it cannot prefix the
 * next scan, and to survive the machine hiccuping mid-swipe. It is the
 * VARIABLE measurement — 9 to 16 ms, a 78% spread — and it is destructive:
 * one gap over the threshold splits a burst in half and the swipe silently
 * does nothing. A tablet has more running in the background than a laptop.
 *
 * So the gap is set at 80 ms, five times the worst observed, rather than
 * tight against it. Raising it does not let a typist through, because the
 * pace check catches that independently: a burst with every gap at 70 ms
 * averages 70 ms per character and fails on pace.
 */
export const BURST_DEFAULTS = {
  minTokenLength: 10,
  maxMsPerChar: 25,
  gapMs: 80,
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
