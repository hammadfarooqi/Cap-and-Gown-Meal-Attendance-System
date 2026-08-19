import { requireAdminApi } from "@/lib/auth/admin";
import { NextResponse } from "next/server";
import { swipeRows } from "@/lib/analytics/queries";
import { isValidRange } from "@/lib/analytics/range";
import { toCsv, EXPORT_COLUMNS } from "@/lib/analytics/csv";

/**
 * The escape hatch. If a board member wants a number no chart shows, this
 * answers it in Excel in two minutes — and it keeps working if nobody ever
 * builds another chart.
 */
export async function GET(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const url = new URL(req.url);
  const range = { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" };

  if (!isValidRange(range)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD, from <= to" }, { status: 400 });
  }

  const rows = await swipeRows(range);

  const csv = toCsv(
    EXPORT_COLUMNS,
    rows.map((row) => [
      row.netid,
      row.fullName,
      row.wasMember,
      row.homeClub,
      row.mealDate,
      row.mealPeriod,
      row.scannedAtLocal,
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cap-and-gown-meals-${range.from}-to-${range.to}.csv"`,
    },
  });
}
