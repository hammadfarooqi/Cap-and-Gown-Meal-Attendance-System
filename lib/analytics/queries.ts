import { serviceClient } from "@/lib/db/client";
import type { DateRange } from "./range";

export type HeadcountRow = {
  mealDate: string;
  mealPeriod: string;
  total: number;
  members: number;
  guests: number;
};

export type HistogramBucket = { minuteOfDay: number; total: number };

export type MealCount = {
  mealPeriod: string;
  total: number;
  members: number;
  guests: number;
};

export type ClubRow = { homeClub: string; visits: number; people: number };

export type ExportRow = {
  netid: string;
  fullName: string;
  wasMember: boolean;
  homeClub: string | null;
  mealDate: string;
  mealPeriod: string;
  scannedAtLocal: string;
};

/** Postgres returns bigint as a string once it exceeds the safe range. */
const num = (value: unknown): number => Number(value ?? 0);

export async function dailyHeadcount(range: DateRange): Promise<HeadcountRow[]> {
  const { data, error } = await serviceClient().rpc("daily_headcount", {
    from_date: range.from,
    to_date: range.to,
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    mealDate: String(row.meal_date),
    mealPeriod: String(row.meal_period),
    total: num(row.total),
    members: num(row.members),
    guests: num(row.guests),
  }));
}

export async function rushHistogram(
  range: DateRange,
  bucketMinutes = 5,
): Promise<HistogramBucket[]> {
  const { data, error } = await serviceClient().rpc("rush_histogram", {
    from_date: range.from,
    to_date: range.to,
    bucket_minutes: bucketMinutes,
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    minuteOfDay: num(row.minute_of_day),
    total: num(row.total),
  }));
}

/** Every meal served today, in the club's timezone. */
export async function todayCounts(): Promise<MealCount[]> {
  const { data, error } = await serviceClient().rpc("today_count");
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    mealPeriod: String(row.meal_period),
    total: num(row.total),
    members: num(row.members),
    guests: num(row.guests),
  }));
}

export async function guestsByClub(range: DateRange): Promise<ClubRow[]> {
  const { data, error } = await serviceClient().rpc("guests_by_club", {
    from_date: range.from,
    to_date: range.to,
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    homeClub: String(row.home_club),
    visits: num(row.visits),
    people: num(row.people),
  }));
}

export async function swipeRows(range: DateRange): Promise<ExportRow[]> {
  const { data, error } = await serviceClient().rpc("swipe_rows", {
    from_date: range.from,
    to_date: range.to,
  });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    netid: String(row.netid),
    fullName: String(row.full_name),
    wasMember: Boolean(row.was_member),
    homeClub: row.home_club === null ? null : String(row.home_club),
    mealDate: String(row.meal_date),
    mealPeriod: String(row.meal_period),
    scannedAtLocal: String(row.scanned_at_local),
  }));
}

/**
 * Average attendance per meal, over DAYS THAT HAD SWIPES.
 *
 * Not over calendar days. A closed day — a break, a one-off kitchen closure —
 * produces no swipes and drops out on its own. This is what makes deferring
 * schedule exceptions to late October safe: dividing by calendar days would
 * quietly deflate every average that spans a break.
 */
export function averagePerServedDay(rows: HeadcountRow[]): { mealPeriod: string; average: number }[] {
  const byPeriod = new Map<string, { total: number; days: Set<string> }>();

  for (const row of rows) {
    const entry = byPeriod.get(row.mealPeriod) ?? { total: 0, days: new Set<string>() };
    entry.total += row.total;
    entry.days.add(row.mealDate);
    byPeriod.set(row.mealPeriod, entry);
  }

  return [...byPeriod.entries()]
    .map(([mealPeriod, { total, days }]) => ({
      mealPeriod,
      average: days.size === 0 ? 0 : Math.round((total / days.size) * 10) / 10,
    }))
    .sort((a, b) => a.mealPeriod.localeCompare(b.mealPeriod));
}
