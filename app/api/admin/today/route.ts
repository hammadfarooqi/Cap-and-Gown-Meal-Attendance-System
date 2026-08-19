import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { todayCounts } from "@/lib/analytics/queries";
import { deriveMeal } from "@/lib/meals/derive";
import type { MealWindow } from "@/lib/meals/types";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const db = serviceClient();

  const [counts, schedule] = await Promise.all([
    todayCounts(),
    db.from("meal_schedule").select("day_of_week, period_name, start_time, end_time, grace_minutes"),
  ]);

  const windows: MealWindow[] = (schedule.data ?? []).map((w) => ({
    dayOfWeek: w.day_of_week,
    periodName: w.period_name,
    startTime: w.start_time,
    endTime: w.end_time,
    graceMinutes: w.grace_minutes,
  }));

  // The same function the tablets run, so the dashboard and the door always
  // agree about which meal is happening.
  const current = deriveMeal(new Date(), windows)?.mealPeriod ?? null;

  return NextResponse.json({
    currentMeal: current,
    counts,
    servedToday: counts.reduce((sum, c) => sum + c.total, 0),
  });
}
