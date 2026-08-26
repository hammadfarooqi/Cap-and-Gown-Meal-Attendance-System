"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "@/lib/analytics/range";
import {
  currentSemester, makeSemester, parseSemesterId, semesterCutoff, type Semester,
} from "@/lib/analytics/semester";
import { availableWindows, buildWindow, type WindowId } from "@/lib/analytics/window";
import { layOutWeek, weekFrom, weekStart, stepWeek, type DaySlot } from "@/lib/analytics/week";
import { clubToday } from "@/lib/analytics/range";
import type { ClubRow, HeadcountRow, HistogramBucket } from "@/lib/analytics/queries";
import { WeekChart } from "./WeekChart";
import { WindowPicker } from "./WindowPicker";
import { SemesterPicker } from "./SemesterPicker";
import { AveragesPanel } from "./AveragesPanel";
import { RushHistogram } from "./RushHistogram";
import { GuestLedger } from "./GuestLedger";

type Payload = {
  headcount: HeadcountRow[];
  histogram: HistogramBucket[];
  clubs: ClubRow[];
  averages: { mealPeriod: string; average: number }[];
};

async function fetchRange(range: DateRange, days: number[] | null): Promise<Payload | null> {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (days) query.set("days", days.join(","));

  const res = await fetch(`/api/admin/analytics?${query}`);
  return res.ok ? await res.json() : null;
}

const weekTitle = (sunday: string) => {
  const range = weekFrom(sunday);
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC", month: "short", day: "numeric",
    });
  return `${fmt(range.from)} – ${fmt(range.to)}`;
};

export function AnalyticsView() {
  const [semesters, setSemesters] = useState<Semester[]>([currentSemester()]);
  const [semester, setSemester] = useState<Semester>(() => currentSemester());

  const [sunday, setSunday] = useState<string>(() => weekStart(clubToday()));
  const [week, setWeek] = useState<DaySlot[] | null>(null);

  const [windowId, setWindowId] = useState<WindowId>("seven");
  const [windowData, setWindowData] = useState<Payload | null>(null);

  const windows = useMemo(() => availableWindows(semester), [semester]);
  const activeWindow = useMemo(() => buildWindow(windowId, semester), [windowId, semester]);

  // Offer only terms that actually hold data, so the selector never promises
  // a semester with nothing behind it.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/semesters");
      if (!res.ok) return;

      const { semesters: ids } = (await res.json()) as { semesters: string[] };
      const parsed = ids.map(parseSemesterId).filter((s): s is Semester => s !== null);
      if (parsed.length > 0) setSemesters(parsed);
    })();
  }, []);

  // A window that does not exist in the selected term cannot stay selected.
  useEffect(() => {
    if (!windows.includes(windowId)) setWindowId("semester");
  }, [windows, windowId]);

  // Landing on a past term, start at its final week rather than a week that
  // is not in it at all.
  useEffect(() => {
    setSunday(weekStart(semesterCutoff(semester)));
  }, [semester]);

  useEffect(() => {
    void (async () => {
      setWeek(null);
      const data = await fetchRange(weekFrom(sunday), null);
      if (data) setWeek(layOutWeek(data.headcount, new Date(), sunday));
    })();
  }, [sunday]);

  const loadWindow = useCallback(async () => {
    setWindowData(null);
    setWindowData(await fetchRange(activeWindow.range, activeWindow.days));
  }, [activeWindow]);

  useEffect(() => {
    void loadWindow();
  }, [loadWindow]);

  const bounds = {
    earliest: semester.range.from,
    latest: semesterCutoff(semester),
  };
  const previous = stepWeek(sunday, -1, bounds);
  const next = stepWeek(sunday, 1, bounds);

  const daysServed = new Set((windowData?.headcount ?? []).map((r) => r.mealDate)).size;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl">Analytics</h1>
        <SemesterPicker
          semesters={semesters}
          selected={semester}
          onSelect={(id) => setSemester(parseSemesterId(id) ?? makeSemester("fall", 2026))}
        />
      </div>

      {week ? (
        <WeekChart
          week={week}
          title={weekTitle(sunday)}
          onPrevious={previous ? () => setSunday(previous) : null}
          onNext={next ? () => setSunday(next) : null}
        />
      ) : (
        <p className="text-ink-muted">Loading…</p>
      )}

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">{activeWindow.label}</h2>
          <WindowPicker available={windows} selected={windowId} onSelect={setWindowId} />
        </div>

        {windowData ? (
          <>
            <AveragesPanel
              averages={windowData.averages}
              daysServed={daysServed}
              unit={activeWindow.unit}
            />
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
