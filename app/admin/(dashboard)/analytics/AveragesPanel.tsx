"use client";

import { mealColorRole } from "@/lib/analytics/week";

const COLOR: Record<string, string> = {
  breakfast: "var(--meal-breakfast)",
  lunch: "var(--meal-lunch)",
  dinner: "var(--meal-dinner)",
};

export type Average = { mealPeriod: string; average: number };

/**
 * Average attendance per service over the chosen window.
 *
 * Horizontal bars, directly labelled, no axis: there are at most four rows
 * and the number is the point. An axis here would be chrome around four
 * figures a reader can simply read.
 *
 * Averages divide by days that were actually SERVED, never by calendar days —
 * a closed day would otherwise drag every figure down silently.
 */
export function AveragesPanel({
  averages,
  daysServed,
  unit = "day",
}: {
  averages: Average[];
  daysServed: number;
  /** What the average divides by — "day", "Monday", "weekday". */
  unit?: string;
}) {
  const peak = Math.max(1, ...averages.map((a) => a.average));

  return (
    <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
      <h2 className="text-lg font-semibold">Average attendance</h2>
      <p className="mb-5 text-sm text-ink-secondary">
        {daysServed === 0
          ? "No meals were served in this window."
          : `Per service, across ${daysServed} ${daysServed === 1 ? unit : `${unit}s`} that served meals.`}
      </p>

      {averages.length > 0 && (
        <ul className="flex flex-col gap-4">
          {averages.map((entry) => (
            <li key={entry.mealPeriod} className="flex items-center gap-4">
              <span className="w-24 shrink-0 text-sm capitalize text-ink-secondary">
                {entry.mealPeriod}
              </span>

              <span className="h-6 flex-1 overflow-hidden rounded-md bg-oxblood-wash">
                <span
                  className="block h-full rounded-md"
                  style={{
                    width: `${Math.max(2, (entry.average / peak) * 100)}%`,
                    background: COLOR[mealColorRole(entry.mealPeriod)],
                  }}
                />
              </span>

              <span
                className="w-14 shrink-0 text-right font-semibold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {entry.average}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
