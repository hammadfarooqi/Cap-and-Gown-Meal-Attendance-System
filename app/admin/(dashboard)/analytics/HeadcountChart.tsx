"use client";

import { useMemo, useState } from "react";
import type { HeadcountRow } from "@/lib/analytics/queries";
import { columnPath, Legend, Tooltip, TableView, EmptyState } from "./chart-parts";

const WIDTH = 860;
const HEIGHT = 300;
const PAD = { top: 16, right: 16, bottom: 40, left: 44 };
const MAX_BAR = 24;
/** White doing the separating. Never a stroke around a mark. */
const SEGMENT_GAP = 2;

type Day = { mealDate: string; members: number; guests: number; total: number };

function byDay(rows: HeadcountRow[]): Day[] {
  const days = new Map<string, Day>();

  for (const row of rows) {
    const day = days.get(row.mealDate) ?? {
      mealDate: row.mealDate, members: 0, guests: 0, total: 0,
    };
    day.members += row.members;
    day.guests += row.guests;
    day.total += row.total;
    days.set(row.mealDate, day);
  }

  return [...days.values()].sort((a, b) => a.mealDate.localeCompare(b.mealDate));
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  });

/** Clean ticks, so the axis carries the values that are not directly labelled. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const step = Math.max(1, Math.ceil(max / 4 / 10) * 10);
  const out: number[] = [];
  for (let v = 0; v <= max + step; v += step) out.push(v);
  return out;
}

export function HeadcountChart({ rows }: { rows: HeadcountRow[] }) {
  const days = useMemo(() => byDay(rows), [rows]);
  const [hover, setHover] = useState<{ day: Day; x: number; y: number } | null>(null);

  if (days.length === 0) {
    return (
      <section className="viz-root rounded-xl p-5" style={{ border: "1px solid var(--viz-border)" }}>
        <h2 className="text-lg font-semibold">Attendance by day</h2>
        <EmptyState>No meals were served in this range.</EmptyState>
      </section>
    );
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = plotWidth / days.length;
  const barWidth = Math.min(MAX_BAR, band * 0.7);

  const axis = ticks(Math.max(...days.map((d) => d.total)));
  const top = axis[axis.length - 1];
  const scale = (value: number) => (value / top) * plotHeight;

  // Label only the busiest day. A number on every column goes unread.
  const busiest = days.reduce((a, b) => (b.total > a.total ? b : a));

  return (
    <section className="viz-root relative rounded-xl p-5" style={{ border: "1px solid var(--viz-border)" }}>
      <h2 className="text-lg font-semibold">Attendance by day</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        Everyone who ate, each day in the range.
      </p>

      <Legend
        items={[
          { label: "Members", color: "var(--series-members)" },
          { label: "Guests", color: "var(--series-guests)" },
        ]}
      />

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`Attendance by day, ${days.length} days`}
      >
        {axis.map((value) => {
          const y = PAD.top + plotHeight - scale(value);
          return (
            <g key={value}>
              <line
                x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y}
                stroke={value === 0 ? "var(--baseline)" : "var(--gridline)"}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8} y={y + 4} textAnchor="end"
                fontSize={11} fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {value}
              </text>
            </g>
          );
        })}

        {days.map((day, index) => {
          const x = PAD.left + index * band + (band - barWidth) / 2;
          const memberHeight = scale(day.members);
          const guestHeight = scale(day.guests);
          const baseline = PAD.top + plotHeight;

          // The gap comes out of the lower segment, so the stack still totals
          // to the right height and the two fills never touch.
          const memberTop = baseline - memberHeight;
          const guestTop = memberTop - guestHeight - (guestHeight > 0 ? SEGMENT_GAP : 0);

          return (
            <g key={day.mealDate}>
              {memberHeight > 0 && (
                <path
                  d={columnPath(x, memberTop, barWidth, memberHeight, day.guests === 0)}
                  fill="var(--series-members)"
                />
              )}
              {guestHeight > 0 && (
                <path
                  d={columnPath(x, guestTop, barWidth, guestHeight, true)}
                  fill="var(--series-guests)"
                />
              )}

              {day.mealDate === busiest.mealDate && (
                <text
                  x={x + barWidth / 2} y={guestTop - 8}
                  textAnchor="middle" fontSize={12} fill="var(--text-primary)"
                >
                  {day.total}
                </text>
              )}

              {(index === 0 || index === days.length - 1 || days.length <= 10) && (
                <text
                  x={x + barWidth / 2} y={HEIGHT - PAD.bottom + 18}
                  textAnchor="middle" fontSize={11} fill="var(--text-muted)"
                >
                  {dayLabel(day.mealDate)}
                </text>
              )}

              {/* A hit target wider than the mark. */}
              <rect
                x={PAD.left + index * band} y={PAD.top}
                width={band} height={plotHeight}
                fill="transparent"
                onMouseEnter={() =>
                  setHover({ day, x: PAD.left + index * band + band / 2, y: guestTop })
                }
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>

      {hover && (
        <Tooltip
          left={`${(hover.x / WIDTH) * 100}%`}
          top={`calc(${(hover.y / HEIGHT) * 100}% + 4rem)`}
        >
          <div className="font-medium">{dayLabel(hover.day.mealDate)}</div>
          <div style={{ color: "var(--text-secondary)" }}>
            {hover.day.members} members · {hover.day.guests} guests
          </div>
          <div className="font-medium">{hover.day.total} total</div>
        </Tooltip>
      )}

      <TableView
        caption="Attendance by day"
        columns={["Date", "Members", "Guests", "Total"]}
        rows={days.map((d) => [dayLabel(d.mealDate), d.members, d.guests, d.total])}
      />
    </section>
  );
}
