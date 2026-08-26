import type { DateRange } from "./range";
import { clubToday, shiftDays } from "./range";
import { clampToSemester, isCurrentSemester, semesterCutoff, type Semester } from "./semester";

export type WindowId =
  | "today" | "three" | "seven" | "thirty"   // relative to now
  | "semester"                                // the whole term
  | "weekdays" | "weekends"                   // by kind of day
  | "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"; // by day of week

export type AnalyticsWindow = {
  id: WindowId;
  label: string;
  range: DateRange;
  /** Postgres day-of-week numbers, or null for every day. */
  days: number[] | null;
  /** How the averages panel should describe what it divided by. */
  unit: string;
};

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABELS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/**
 * Relative windows are anchored to the clock, so they only exist while the
 * clock is inside the semester being viewed. Re-anchoring "last 7 days" to a
 * past term's final week would silently change what the words mean, which is
 * worse than not offering them.
 */
export const RELATIVE_WINDOWS: { id: WindowId; label: string; back: number }[] = [
  { id: "today", label: "Today", back: 0 },
  { id: "three", label: "Last 3 days", back: 2 },
  { id: "seven", label: "Last 7 days", back: 6 },
  { id: "thirty", label: "Last 30 days", back: 29 },
];

export function availableWindows(semester: Semester, now: Date = new Date()): WindowId[] {
  const semesterRelative: WindowId[] = [
    "semester", "weekdays", "weekends", ...DAY_IDS,
  ];

  return isCurrentSemester(semester, now)
    ? [...RELATIVE_WINDOWS.map((w) => w.id), ...semesterRelative]
    : semesterRelative;
}

export function buildWindow(
  id: WindowId,
  semester: Semester,
  now: Date = new Date(),
): AnalyticsWindow {
  const cutoff = semesterCutoff(semester, now);
  const wholeTerm: DateRange = { from: semester.range.from, to: cutoff };

  const relative = RELATIVE_WINDOWS.find((w) => w.id === id);
  if (relative) {
    const today = clubToday(now);
    return {
      id,
      label: relative.label,
      range: clampToSemester({ from: shiftDays(today, -relative.back), to: today }, semester),
      days: null,
      unit: "day",
    };
  }

  if (id === "semester") {
    return { id, label: semester.label, range: wholeTerm, days: null, unit: "day" };
  }

  if (id === "weekdays") {
    return { id, label: "Every weekday", range: wholeTerm, days: [1, 2, 3, 4, 5], unit: "weekday" };
  }

  if (id === "weekends") {
    return { id, label: "Every weekend day", range: wholeTerm, days: [0, 6], unit: "weekend day" };
  }

  const dayIndex = DAY_IDS.indexOf(id as (typeof DAY_IDS)[number]);
  return {
    id,
    label: `Every ${DAY_LABELS[dayIndex].slice(0, -1)}`,
    range: wholeTerm,
    days: [dayIndex],
    unit: DAY_LABELS[dayIndex].slice(0, -1),
  };
}
