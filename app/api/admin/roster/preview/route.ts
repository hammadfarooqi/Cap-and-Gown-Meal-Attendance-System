import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { parseRoster } from "@/lib/roster/parse";
import { diffRoster, isLargeDrop, type CurrentMember } from "@/lib/roster/diff";

/**
 * Describe what a file would do. It writes nothing.
 *
 * Applying is a separate, explicit action against the reviewed diff, so what
 * an officer confirms on screen is exactly what runs.
 */
export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const csv = await req.text();
  if (!csv.trim()) {
    return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  }

  const { rows, errors } = parseRoster(csv);
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { data, error } = await serviceClient()
    .from("people")
    .select("netid, full_name, class_year, is_member");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const current: CurrentMember[] = data.map((p) => ({
    netid: p.netid,
    fullName: p.full_name,
    classYear: p.class_year,
    isMember: p.is_member,
  }));

  const diff = diffRoster(rows, current);
  const memberCount = current.filter((p) => p.isMember).length;

  return NextResponse.json({
    diff,
    largeDrop: isLargeDrop(diff, memberCount),
    memberCount,
  });
}
