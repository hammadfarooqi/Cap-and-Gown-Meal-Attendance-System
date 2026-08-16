import { CLUB_TIMEZONE, type DerivedMeal, type MealWindow } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clubClock = new Intl.DateTimeFormat("en-US", {
  timeZone: CLUB_TIMEZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Parts of an instant as seen on a wall clock in the club's timezone.
 *
 * Everything goes through Intl rather than the Date accessors, because
 * `getHours()` and friends read the machine's own timezone. A tablet set to
 * the wrong zone would otherwise disagree with the server about which meal a
 * scan belongs to.
 */
function clubLocalParts(instant: Date) {
  const parts: Record<string, string> = {};
  for (const p of clubClock.formatToParts(instant)) parts[p.type] = p.value;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAYS.indexOf(parts.weekday),
    // Some ICU versions render midnight as hour "24"; normalise it to 0.
    secondsOfDay:
      (Number(parts.hour) % 24) * 3600 +
      Number(parts.minute) * 60 +
      Number(parts.second),
  };
}

function timeToSeconds(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
}

/**
 * Place a scan into a meal, or return null if it falls outside every window.
 *
 * Both the server and the tablet call this. The server's answer is the one
 * that reaches the database; the tablet's only drives the success message.
 * Ties between overlapping windows resolve to the first match in `schedule`,
 * so both callers agree given the same input.
 */
export function deriveMeal(
  scannedAt: Date,
  schedule: MealWindow[],
): DerivedMeal | null {
  const local = clubLocalParts(scannedAt);

  for (const w of schedule) {
    if (w.dayOfWeek !== local.dayOfWeek) continue;

    const grace = w.graceMinutes * 60;
    const from = timeToSeconds(w.startTime) - grace;
    const to = timeToSeconds(w.endTime) + grace;

    if (local.secondsOfDay >= from && local.secondsOfDay <= to) {
      return { mealDate: local.date, mealPeriod: w.periodName };
    }
  }

  return null;
}
