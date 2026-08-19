import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";

/**
 * Everything a tablet needs to serve a rush without touching the network
 * again: the roster, the token map, and the schedule.
 *
 * The tablet fetches this once at startup and thereafter only when a version
 * stamp moves, so this being the one heavy request is fine.
 */
export async function GET(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = serviceClient();

  const [people, credentials, schedule, clubs] = await Promise.all([
    db.from("people").select("netid, full_name, is_member, home_club, photo_path"),
    db.from("credentials").select("token, netid"),
    db
      .from("meal_schedule")
      .select("day_of_week, period_name, start_time, end_time, grace_minutes"),
    db.from("clubs").select("name").order("name"),
  ]);

  if (people.error || credentials.error || schedule.error || clubs.error) {
    return NextResponse.json({ error: "bootstrap failed" }, { status: 500 });
  }

  return NextResponse.json(
    await envelope({
      people: people.data.map((p) => ({
        netid: p.netid,
        fullName: p.full_name,
        isMember: p.is_member,
        homeClub: p.home_club,
        photoPath: p.photo_path,
      })),
      credentials: credentials.data,
      clubs: clubs.data.map((c) => c.name),
      schedule: schedule.data.map((w) => ({
        dayOfWeek: w.day_of_week,
        periodName: w.period_name,
        startTime: w.start_time,
        endTime: w.end_time,
        graceMinutes: w.grace_minutes,
      })),
    }),
  );
}
