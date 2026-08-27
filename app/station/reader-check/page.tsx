"use client";

import { useEffect, useRef, useState } from "react";
import { parseCardSwipe } from "@/lib/scan/card";
import { BURST_DEFAULTS } from "@/lib/scan/burst";

/** Exactly what the burst detector would decide about this capture. */
function accepted(capture: Capture): boolean {
  return (
    capture.chars >= BURST_DEFAULTS.minTokenLength &&
    capture.msPerChar <= BURST_DEFAULTS.maxMsPerChar &&
    capture.maxGapMs <= BURST_DEFAULTS.gapMs &&
    capture.enterCount === 1
  );
}

type Capture = {
  raw: string;
  chars: number;
  totalMs: number;
  msPerChar: number;
  maxGapMs: number;
  endedWithEnter: boolean;
  enterCount: number;
  parsed: ReturnType<typeof parseCardSwipe>;
};

/**
 * What the reader actually does, measured rather than assumed.
 *
 * This exists because the burst detector's thresholds are guesses until a
 * real card is swiped through a real reader on the club's own tablets. It
 * listens raw — no burst logic — and reports the timings those thresholds
 * have to accommodate. Take it to the club on the on-site day.
 */
export default function ReaderCheckPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const buffer = useRef<{ text: string; startedAt: number; lastAt: number; maxGap: number; enters: number } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const finish = () => {
      const b = buffer.current;
      buffer.current = null;
      if (!b || b.text.length === 0) return;

      setCaptures((list) => [
        {
          raw: b.text,
          chars: b.text.length,
          totalMs: Math.round(b.lastAt - b.startedAt),
          msPerChar: Math.round(((b.lastAt - b.startedAt) / Math.max(1, b.text.length)) * 10) / 10,
          maxGapMs: Math.round(b.maxGap),
          endedWithEnter: b.enters > 0,
          enterCount: b.enters,
          parsed: parseCardSwipe(b.text),
        },
        ...list,
      ].slice(0, 8));
    };

    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();

      if (!buffer.current) {
        buffer.current = { text: "", startedAt: now, lastAt: now, maxGap: 0, enters: 0 };
      }
      const b = buffer.current;

      const gap = now - b.lastAt;
      if (b.text.length > 0 && gap > b.maxGap) b.maxGap = gap;
      b.lastAt = now;

      if (e.key === "Enter") {
        b.enters += 1;
        e.preventDefault();
      } else if (e.key.length === 1) {
        b.text += e.key;
      }

      // Anything quiet for 400ms is a finished swipe.
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(finish, 400);
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  return (
    <main className="station-dark min-h-screen bg-page p-8 text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="font-display text-4xl">Reader check</h1>
          <p className="mt-2 text-ink-secondary">
            Swipe a card. This measures what the reader really sends, with no
            interpretation in the way.
          </p>
        </div>

        {captures.length === 0 && (
          <p className="rounded-xl bg-surface p-8 text-center text-ink-muted ring-1 ring-line">
            Waiting for a swipe…
          </p>
        )}

        {captures.map((capture, index) => (
          <section
            key={index}
            className="flex flex-col gap-3 rounded-xl bg-surface p-5 ring-1 ring-line"
          >
            <code className="break-all rounded-lg bg-page p-3 text-sm">{capture.raw}</code>

            {/* The two numbers the detector actually tests are the pace and
                the gap. They are shown against the thresholds so a swipe on
                the club's own tablets answers the question directly. */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
              <Stat label="Characters" value={String(capture.chars)} />
              <Stat label="Total time" value={`${capture.totalMs} ms`} />
              <Stat
                label="Pace (limit 25)"
                value={`${capture.msPerChar} ms/char`}
                warn={capture.msPerChar >= BURST_DEFAULTS.maxMsPerChar}
              />
              <Stat
                label="Largest gap (limit 80)"
                value={`${capture.maxGapMs} ms`}
                warn={capture.maxGapMs >= BURST_DEFAULTS.gapMs}
              />
              <Stat
                label="Enter keys"
                value={String(capture.enterCount)}
                warn={capture.enterCount !== 1}
              />
            </dl>

            <p className={accepted(capture) ? "text-good" : "text-danger"}>
              {accepted(capture)
                ? "This swipe would be accepted."
                : "This swipe would be IGNORED — send these numbers on."}
            </p>

            <div className="text-sm text-ink-secondary">
              <p>
                Card number:{" "}
                <strong className="text-ink">{capture.parsed.token ?? "none"}</strong>
              </p>
              {capture.parsed.nameParts.length > 0 && (
                <p>
                  Name on card:{" "}
                  <strong className="text-ink">{capture.parsed.nameParts.join(" ")}</strong>
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={warn ? "text-lg text-danger" : "text-lg"}>{value}</dd>
    </div>
  );
}
