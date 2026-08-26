"use client";

import { useState } from "react";
import { columnPath, Tooltip, TableView } from "./chart-parts";
import { mealColorRole, type DaySlot } from "@/lib/analytics/week";

const WIDTH = 880;
const HEIGHT = 320;
const PAD = { top: 20, right: 16, bottom: 48, left: 44 };
const BAR_GAP = 2;
const MAX_BAR = 26;

const COLOR: Record<string, string> = {
  breakfast: "var(--meal-breakfast)",
  lunch: "var(--meal-lunch)",
  dinner: "var(--meal-dinner)",
};

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const step = Math.max(10, Math.ceil(max / 4 / 10) * 10);
  const out: number[] = [];
  for (let v = 0; v <= max + step; v += step) out.push(v);
  return out;
}

/**
 * The week, as a fixed frame.
 *
 * Seven days, Sunday to Saturday, every time — with one bar per service, so
 * three on a weekday and two at a weekend. Days still to come are drawn empty
 * rather than left out, so the week keeps the same shape from Monday to
 * Sunday and can be read against last week without re-orienting.
 *
 * Brunch wears the lunch colour: it is the same service on a different day.
 */
export function WeekChart({ week }: { week: DaySlot[] }) {
  const [hover, setHover] = useState<
    { day: DaySlot; meal: DaySlot["meals"][number]; x: number; y: number } | null
  >(null);

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = plotWidth / 7;

  const axis = ticks(Math.max(...week.flatMap((d) => d.meals.map((m) => m.total))));
  const top = axis[axis.length - 1];
  const scale = (value: number) => (value / top) * plotHeight;

  const served = week.filter((d) => d.hasHappened).flatMap((d) => d.meals);
  const nothingYet = served.every((m) => m.total === 0);

  return (
    <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">This week</h2>
        <ul className="flex flex-wrap gap-4 text-sm text-ink-secondary">
          {(["breakfast", "lunch", "dinner"] as const).map((role) => (
            <li key={role} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: COLOR[role] }}
              />
              {role === "lunch" ? "Lunch / brunch" : role[0].toUpperCase() + role.slice(1)}
            </li>
          ))}
        </ul>
      </div>
      <p className="mb-4 text-sm text-ink-secondary">
        Every service, Sunday to Saturday. Days still to come are left empty.
      </p>

      {nothingYet ? (
        <p data-testid="week-empty" className="py-16 text-center text-ink-muted">
          No meals served yet this week.
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full"
            role="img"
            aria-label="Attendance for each service this week, Sunday to Saturday"
          >
            {axis.map((value) => {
              const y = PAD.top + plotHeight - scale(value);
              return (
                <g key={value}>
                  <line
                    x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y}
                    stroke={value === 0 ? "var(--line-strong)" : "var(--line)"}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 8} y={y + 4} textAnchor="end"
                    fontSize={11} fill="var(--ink-muted)"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {value}
                  </text>
                </g>
              );
            })}

            {week.map((day, dayIndex) => {
              const slotStart = PAD.left + dayIndex * band;
              const count = day.meals.length;
              const barWidth = Math.min(MAX_BAR, (band * 0.72 - BAR_GAP * (count - 1)) / count);
              const groupWidth = barWidth * count + BAR_GAP * (count - 1);
              const groupStart = slotStart + (band - groupWidth) / 2;

              return (
                <g key={day.date}>
                  {day.meals.map((meal, mealIndex) => {
                    const x = groupStart + mealIndex * (barWidth + BAR_GAP);
                    const height = scale(meal.total);
                    const y = PAD.top + plotHeight - height;

                    return (
                      <g key={meal.mealPeriod}>
                        {height > 0 && (
                          <path
                            d={columnPath(x, y, barWidth, height, true)}
                            fill={COLOR[mealColorRole(meal.mealPeriod)]}
                          />
                        )}
                        <rect
                          x={x} y={PAD.top} width={barWidth} height={plotHeight}
                          fill="transparent"
                          onMouseEnter={() => setHover({ day, meal, x: x + barWidth / 2, y })}
                          onMouseLeave={() => setHover(null)}
                        />
                      </g>
                    );
                  })}

                  <text
                    x={slotStart + band / 2} y={HEIGHT - PAD.bottom + 20}
                    textAnchor="middle" fontSize={12}
                    fill={day.hasHappened ? "var(--ink-secondary)" : "var(--ink-muted)"}
                  >
                    {day.weekday.slice(0, 3)}
                  </text>
                  <text
                    x={slotStart + band / 2} y={HEIGHT - PAD.bottom + 36}
                    textAnchor="middle" fontSize={11} fill="var(--ink-muted)"
                  >
                    {day.date.slice(8)}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && (
            <Tooltip
              left={`${(hover.x / WIDTH) * 100}%`}
              top={`calc(${(hover.y / HEIGHT) * 100}% - 0.5rem)`}
            >
              <div className="font-medium capitalize">
                {hover.day.weekday} {hover.meal.mealPeriod}
              </div>
              <div className="text-ink-secondary">
                {hover.meal.members} members · {hover.meal.guests} guests
              </div>
              <div className="font-medium">{hover.meal.total} total</div>
            </Tooltip>
          )}
        </div>
      )}

      <TableView
        caption="Attendance for each service this week"
        columns={["Day", "Service", "Members", "Guests", "Total"]}
        rows={week.flatMap((day) =>
          day.meals.map((meal) => [
            day.weekday, meal.mealPeriod, meal.members, meal.guests, meal.total,
          ]),
        )}
      />
    </section>
  );
}
