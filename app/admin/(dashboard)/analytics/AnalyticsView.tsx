"use client";

import { useCallback, useEffect, useState } from "react";
import { presetRange, type DateRange, type RangePreset } from "@/lib/analytics/range";
import { currentWeek, layOutWeek, type DaySlot } from "@/lib/analytics/week";
import type { ClubRow, HeadcountRow, HistogramBucket } from "@/lib/analytics/queries";
import { WeekChart } from "./WeekChart";
import { AveragesPanel } from "./AveragesPanel";
import { RushHistogram } from "./RushHistogram";
import { GuestLedger } from "./GuestLedger";

type Payload = {
  headcount: HeadcountRow[];
  histogram: HistogramBucket[];
  clubs: ClubRow[];
  averages: { mealPeriod: string; average: number }[];
};

const WINDOWS: { value: Extract<RangePreset, "today" | "three" | "week">; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "three", label: "Last 3 days" },
  { value: "week", label: "Last 7 days" },
];

async function fetchRange(range: DateRange): Promise<Payload | null> {
  const res = await fetch(`/api/admin/analytics?from=${range.from}&to=${range.to}`);
  return res.ok ? await res.json() : null;
}

export function AnalyticsView() {
  const [week, setWeek] = useState<DaySlot[] | null>(null);
  const [windowPreset, setWindowPreset] = useState<"today" | "three" | "week">("week");
  const [windowData, setWindowData] = useState<Payload | null>(null);

  // The week is a fixed frame. It has no range control, because a week that
  // could be any span is not a week.
  useEffect(() => {
    void (async () => {
      const data = await fetchRange(currentWeek());
      if (data) setWeek(layOutWeek(data.headcount));
    })();
  }, []);

  const loadWindow = useCallback(async (preset: "today" | "three" | "week") => {
    setWindowData(await fetchRange(presetRange(preset)));
  }, []);

  useEffect(() => {
    void loadWindow(windowPreset);
  }, [windowPreset, loadWindow]);

  const daysServed = new Set(
    (windowData?.headcount ?? []).map((row) => row.mealDate),
  ).size;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-6">
        <h1 className="font-display text-3xl">Analytics</h1>
        {week ? <WeekChart week={week} /> : <p className="text-ink-muted">Loading…</p>}
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Recent</h2>

          <div
            role="group"
            aria-label="Time window"
            className="flex overflow-hidden rounded-lg ring-1 ring-line-strong"
          >
            {WINDOWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={windowPreset === option.value}
                onClick={() => setWindowPreset(option.value)}
                className={`px-4 py-2 text-sm transition-colors duration-150 ${
                  windowPreset === option.value
                    ? "bg-oxblood text-white"
                    : "bg-surface text-ink-secondary hover:bg-oxblood-wash"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {windowData ? (
          <>
            <AveragesPanel averages={windowData.averages} daysServed={daysServed} />
            <RushHistogram buckets={windowData.histogram} />
            <GuestLedger rows={windowData.clubs} />
          </>
        ) : (
          <p className="text-ink-muted">Loading…</p>
        )}
      </section>
    </div>
  );
}
