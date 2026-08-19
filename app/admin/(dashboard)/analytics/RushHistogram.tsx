"use client";

import { useMemo, useState } from "react";
import type { HistogramBucket } from "@/lib/analytics/queries";
import { columnPath, Tooltip, TableView, EmptyState } from "./chart-parts";

const WIDTH = 420;
const HEIGHT = 180;
const PAD = { top: 24, right: 12, bottom: 32, left: 34 };
const BAR_GAP = 2;
const MAX_BAR = 24;

/** Minute-of-day to a clock face. The values are already New York minutes. */
export function clockLabel(minuteOfDay: number): string {
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${String(minute).padStart(2, "0")}${suffix}`;
}

function Facet({
  mealPeriod,
  buckets,
  yMax,
}: {
  mealPeriod: string;
  buckets: HistogramBucket[];
  yMax: number;
}) {
  const [hover, setHover] = useState<{ bucket: HistogramBucket; x: number; y: number } | null>(null);

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const first = buckets[0].minuteOfDay;
  const last = buckets[buckets.length - 1].minuteOfDay;
  const step = buckets.length > 1 ? buckets[1].minuteOfDay - buckets[0].minuteOfDay : 5;
  const slots = (last - first) / step + 1;

  const slot = plotWidth / slots;
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot - BAR_GAP));

  const peak = buckets.reduce((a, b) => (b.total > a.total ? b : a));
  const scale = (value: number) => (value / yMax) * plotHeight;
  const xFor = (minute: number) => PAD.left + ((minute - first) / step) * slot + (slot - barWidth) / 2;

  return (
    <figure className="relative m-0">
      <figcaption className="text-sm font-medium">
        {/* Capitalise only the meal name. On the whole caption this also
            turns "busiest at" into "Busiest At". */}
        <span className="capitalize">{mealPeriod}</span>
        <span className="ml-2 font-normal" style={{ color: "var(--text-secondary)" }}>
          busiest at {clockLabel(peak.minuteOfDay)}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`${mealPeriod}. Peak at ${clockLabel(peak.minuteOfDay)} with ${peak.total} scans.`}
      >
        <line
          x1={PAD.left} x2={WIDTH - PAD.right}
          y1={PAD.top + plotHeight} y2={PAD.top + plotHeight}
          stroke="var(--baseline)" strokeWidth={1}
        />
        <text
          x={PAD.left - 6} y={PAD.top + 4} textAnchor="end"
          fontSize={10} fill="var(--text-muted)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {yMax}
        </text>

        {buckets.map((bucket) => {
          const height = scale(bucket.total);
          const x = xFor(bucket.minuteOfDay);
          const y = PAD.top + plotHeight - height;

          return (
            <g key={bucket.minuteOfDay}>
              <path d={columnPath(x, y, barWidth, height, true)} fill="var(--series-members)" />
              {bucket.minuteOfDay === peak.minuteOfDay && (
                <text
                  x={x + barWidth / 2} y={y - 6}
                  textAnchor="middle" fontSize={11} fill="var(--text-primary)"
                >
                  {bucket.total}
                </text>
              )}
              <rect
                x={x - BAR_GAP / 2} y={PAD.top} width={slot} height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover({ bucket, x: x + barWidth / 2, y })}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        <text x={PAD.left} y={HEIGHT - PAD.bottom + 16} fontSize={10} fill="var(--text-muted)">
          {clockLabel(first)}
        </text>
        <text
          x={WIDTH - PAD.right} y={HEIGHT - PAD.bottom + 16}
          textAnchor="end" fontSize={10} fill="var(--text-muted)"
        >
          {clockLabel(last)}
        </text>
      </svg>

      {hover && (
        <Tooltip
          left={`${(hover.x / WIDTH) * 100}%`}
          top={`calc(${(hover.y / HEIGHT) * 100}% + 1.5rem)`}
        >
          <div className="font-medium">{clockLabel(hover.bucket.minuteOfDay)}</div>
          <div style={{ color: "var(--text-secondary)" }}>
            {hover.bucket.total} {hover.bucket.total === 1 ? "scan" : "scans"}
          </div>
        </Tooltip>
      )}
    </figure>
  );
}

/**
 * When is the line longest — one small multiple per meal.
 *
 * Not one wide axis. Lunch and dinner are six hours apart, so a single
 * minute-of-day axis is mostly empty afternoon with two clusters of hairline
 * bars at either end. Rendering it that way is what showed the problem.
 *
 * The facets share a y-scale, so a glance compares lunch against dinner
 * honestly. One series, so no legend: the caption names it.
 */
export function RushHistogram({ buckets }: { buckets: HistogramBucket[] }) {
  const facets = useMemo(() => {
    const byMeal = new Map<string, HistogramBucket[]>();
    for (const bucket of buckets) {
      byMeal.set(bucket.mealPeriod, [...(byMeal.get(bucket.mealPeriod) ?? []), bucket]);
    }
    return [...byMeal.entries()]
      .map(([mealPeriod, rows]) => ({
        mealPeriod,
        rows: [...rows].sort((a, b) => a.minuteOfDay - b.minuteOfDay),
      }))
      .sort((a, b) => a.rows[0].minuteOfDay - b.rows[0].minuteOfDay);
  }, [buckets]);

  const yMax = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <section className="viz-root rounded-xl p-5" style={{ border: "1px solid var(--viz-border)" }}>
      <h2 className="text-lg font-semibold">When the line is longest</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--text-secondary)" }}>
        Scans in five-minute buckets. Each meal is shown separately, on the same scale.
      </p>

      {facets.length === 0 ? (
        <EmptyState>No scans in this range.</EmptyState>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {facets.map((facet) => (
              <Facet
                key={facet.mealPeriod}
                mealPeriod={facet.mealPeriod}
                buckets={facet.rows}
                yMax={yMax}
              />
            ))}
          </div>

          <TableView
            caption="Scans by time of day"
            columns={["Meal", "Time", "Scans"]}
            rows={buckets.map((b) => [b.mealPeriod, clockLabel(b.minuteOfDay), b.total])}
          />
        </>
      )}
    </section>
  );
}
