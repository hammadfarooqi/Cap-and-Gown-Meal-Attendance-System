import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { dailyHeadcount, rushHistogram, guestsByClub, averagePerServedDay } from "@/lib/analytics/queries";
import { isValidRange } from "@/lib/analytics/range";

export async function GET(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(req.url);
  const range = { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" };

  // Shape-checked before it reaches SQL. The query functions take dates, but
  // validating here means a malformed range fails fast with a clear answer.
  if (!isValidRange(range)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD, from <= to" }, { status: 400 });
  }

  // Day-of-week filter, e.g. "every Monday this semester". Absent means
  // every day. Parsed strictly so nothing but 0-6 reaches SQL.
  const daysParam = url.searchParams.get("days");
  const days = daysParam
    ? daysParam.split(",").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : null;

  if (daysParam && (days === null || days.length === 0)) {
    return NextResponse.json({ error: "days must be 0-6" }, { status: 400 });
  }

  const [headcount, histogram, clubs] = await Promise.all([
    dailyHeadcount(range, days),
    rushHistogram(range, 5, days),
    guestsByClub(range, days),
  ]);

  return NextResponse.json({
    range,
    headcount,
    histogram,
    clubs,
    averages: averagePerServedDay(headcount),
  });
}
