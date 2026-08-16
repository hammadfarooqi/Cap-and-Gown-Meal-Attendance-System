import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";
import { deriveMeal } from "@/lib/meals/derive";
import type { MealWindow } from "@/lib/meals/types";

type IncomingSwipe = {
  netid: string;
  scannedAt: string;
  entryMethod: "scan" | "manual";
};

const UNIQUE_VIOLATION = "23505";

/**
 * Accept a batch of queued swipes from a tablet.
 *
 * Sending the same batch again is free and always correct. The swipes
 * primary key rejects a duplicate, and that specific rejection is treated as
 * success — which is why the tablet needs no acknowledgement protocol, no
 * sequence numbers, and no exactly-once machinery.
 *
 * The meal is derived here, not on the tablet. A tablet only reports what it
 * saw and when.
 */
export async function POST(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.swipes)) {
    return NextResponse.json({ error: "swipes array required" }, { status: 400 });
  }

  const db = serviceClient();

  const { data: rows, error: scheduleError } = await db
    .from("meal_schedule")
    .select("day_of_week, period_name, start_time, end_time, grace_minutes");
  if (scheduleError) {
    return NextResponse.json({ error: "schedule unavailable" }, { status: 500 });
  }

  const schedule: MealWindow[] = rows.map((w) => ({
    dayOfWeek: w.day_of_week,
    periodName: w.period_name,
    startTime: w.start_time,
    endTime: w.end_time,
    graceMinutes: w.grace_minutes,
  }));

  let accepted = 0;
  let skipped = 0;

  for (const swipe of body.swipes as IncomingSwipe[]) {
    const scannedAt = new Date(swipe.scannedAt);
    if (Number.isNaN(scannedAt.getTime())) {
      skipped += 1;
      continue;
    }

    const meal = deriveMeal(scannedAt, schedule);
    if (!meal) {
      // Outside every window. Nobody ate, so there is nothing to record.
      skipped += 1;
      continue;
    }

    const { data: person } = await db
      .from("people")
      .select("is_member")
      .eq("netid", swipe.netid)
      .maybeSingle();

    if (!person) {
      skipped += 1;
      continue;
    }

    const { error } = await db.from("swipes").insert({
      netid: swipe.netid,
      meal_date: meal.mealDate,
      meal_period: meal.mealPeriod,
      // Snapshot, so a membership change in January never rewrites autumn.
      was_member: person.is_member,
      scanned_at: scannedAt.toISOString(),
      station_id: device.deviceId,
      entry_method: swipe.entryMethod === "manual" ? "manual" : "scan",
    });

    if (!error) {
      accepted += 1;
    } else if (error.code === UNIQUE_VIOLATION) {
      // Already counted. Re-sending is meant to be free.
      skipped += 1;
    } else {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(await envelope({ accepted, skipped }));
}
