export type DateRange = {
  /** New York calendar date, "YYYY-MM-DD", inclusive. */
  from: string;
  /** New York calendar date, "YYYY-MM-DD", inclusive. */
  to: string;
};

export type RangePreset = "today" | "three" | "week" | "month" | "semester";

const CLUB_TIMEZONE = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUB_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today, as the club sees it. en-CA formats as YYYY-MM-DD. */
export function clubToday(now: Date = new Date()): string {
  return formatter.format(now);
}

/** Shift a "YYYY-MM-DD" by whole days without touching a timezone. */
export function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The academic term containing a date.
 *
 * Autumn runs from 1 September; spring from 15 January. A date before 15
 * January belongs to the autumn term that began the previous year, which is
 * how a business manager pulling numbers in early January expects it to read.
 */
export function semesterStart(today: string): string {
  const [year, month, day] = today.split("-").map(Number);

  if (month > 9 || (month === 9 && day >= 1)) return `${year}-09-01`;
  if (month > 1 || (month === 1 && day >= 15)) return `${year}-01-15`;
  return `${year - 1}-09-01`;
}

export function presetRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = clubToday(now);

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "three":
      return { from: shiftDays(today, -2), to: today };
    case "week":
      return { from: shiftDays(today, -6), to: today };
    case "month":
      return { from: shiftDays(today, -29), to: today };
    case "semester":
      return { from: semesterStart(today), to: today };
  }
}

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidRange(range: Partial<DateRange>): range is DateRange {
  if (!range.from || !range.to) return false;
  if (!SHAPE.test(range.from) || !SHAPE.test(range.to)) return false;
  return range.from <= range.to;
}
