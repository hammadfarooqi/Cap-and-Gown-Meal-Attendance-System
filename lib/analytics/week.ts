import type { HeadcountRow } from "./queries";
import { clubToday, shiftDays, type DateRange } from "./range";

export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/** Weekdays get three services; weekends get two. */
export const WEEKDAY_MEALS = ["breakfast", "lunch", "dinner"] as const;
export const WEEKEND_MEALS = ["brunch", "dinner"] as const;

export type DaySlot = {
  /** 0 = Sunday. */
  dayOfWeek: number;
  weekday: string;
  date: string;
  /** False for days later in the week than today — drawn, but empty. */
  hasHappened: boolean;
  meals: { mealPeriod: string; total: number; members: number; guests: number }[];
};

/**
 * The Sunday that begins the week containing `today`, in the club's timezone.
 */
export function weekStart(today: string): string {
  // Midday UTC keeps the arithmetic clear of every daylight-saving boundary.
  const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftDays(today, -dayOfWeek);
}

export function currentWeek(now: Date = new Date()): DateRange {
  const today = clubToday(now);
  const from = weekStart(today);
  return { from, to: shiftDays(from, 6) };
}

/**
 * Lay a week out as seven fixed days, Sunday through Saturday, each carrying
 * its own meals.
 *
 * Always seven, and always in that order — a week that redraws itself around
 * whichever days happen to have data is a week you cannot read at a glance or
 * compare against last week. Days still to come are present and empty rather
 * than missing, so the shape of the week stays constant as it fills in.
 */
export function layOutWeek(
  rows: HeadcountRow[],
  now: Date = new Date(),
): DaySlot[] {
  const today = clubToday(now);
  const start = weekStart(today);

  const byDateAndMeal = new Map<string, HeadcountRow>();
  for (const row of rows) byDateAndMeal.set(`${row.mealDate}|${row.mealPeriod}`, row);

  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const date = shiftDays(start, dayOfWeek);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const services = isWeekend ? WEEKEND_MEALS : WEEKDAY_MEALS;

    return {
      dayOfWeek,
      weekday: WEEKDAY_NAMES[dayOfWeek],
      date,
      hasHappened: date <= today,
      meals: services.map((mealPeriod) => {
        const row = byDateAndMeal.get(`${date}|${mealPeriod}`);
        return {
          mealPeriod,
          total: row?.total ?? 0,
          members: row?.members ?? 0,
          guests: row?.guests ?? 0,
        };
      }),
    };
  });
}

/**
 * Brunch is lunch. It is the same service on a different day, so it wears the
 * same colour — otherwise a reader compares Saturday's bar against Tuesday's
 * and sees a difference that is not there.
 */
export function mealColorRole(mealPeriod: string): "breakfast" | "lunch" | "dinner" {
  if (mealPeriod === "breakfast") return "breakfast";
  if (mealPeriod === "dinner") return "dinner";
  return "lunch";
}
