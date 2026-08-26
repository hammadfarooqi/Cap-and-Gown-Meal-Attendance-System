import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { semestersWithData } from "@/lib/analytics/queries";
import { currentSemester } from "@/lib/analytics/semester";

/**
 * The terms that actually hold meals, newest first, with the current one
 * always present so a term that has only just begun is still selectable.
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const rows = await semestersWithData();
  const ids = new Set(rows.map((row) => `${row.term}-${row.year}`));
  ids.add(currentSemester().id);

  return NextResponse.json({
    semesters: [...ids].sort().reverse(),
  });
}
