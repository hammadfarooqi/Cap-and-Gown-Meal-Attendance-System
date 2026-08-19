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

  const [headcount, histogram, clubs] = await Promise.all([
    dailyHeadcount(range),
    rushHistogram(range, 5),
    guestsByClub(range),
  ]);

  return NextResponse.json({
    range,
    headcount,
    histogram,
    clubs,
    averages: averagePerServedDay(headcount),
  });
}
