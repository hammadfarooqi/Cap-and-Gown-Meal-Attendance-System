import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { bumpVersion } from "@/lib/api/envelope";
import { isValidNetid } from "@/lib/directory/lookup";
import type { RosterDiff } from "@/lib/roster/diff";

/**
 * Apply a diff the officer has already seen.
 *
 * It takes the reviewed diff rather than the file, so nothing can change
 * between what was shown and what runs — a re-parse could differ if the
 * roster moved underneath, and the person confirmed the numbers on screen.
 */
export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { diff?: RosterDiff } | null;
  const diff = body?.diff;

  if (!diff || !Array.isArray(diff.add) || !Array.isArray(diff.update) || !Array.isArray(diff.drop)) {
    return NextResponse.json({ error: "A reviewed diff is required." }, { status: 400 });
  }

  const everyNetid = [
    ...diff.add.map((r) => r.netid),
    ...diff.update.map((r) => r.netid),
    ...diff.drop.map((r) => r.netid),
  ];
  if (everyNetid.some((netid) => !isValidNetid(netid))) {
    return NextResponse.json({ error: "That diff contains an invalid netID." }, { status: 400 });
  }

  const db = serviceClient();

  const joining = [...diff.add, ...diff.update].map((row) => ({
    netid: row.netid,
    full_name: row.fullName,
    class_year: row.classYear,
    is_member: true,
    home_club: "Cap & Gown",
  }));

  if (joining.length > 0) {
    const { error } = await db.from("people").upsert(joining, { onConflict: "netid" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (diff.drop.length > 0) {
    // Never a delete. Their swipe history stays attached, and they can still
    // eat here as somebody's guest.
    const { error } = await db
      .from("people")
      .update({ is_member: false, home_club: "None" })
      .in("netid", diff.drop.map((r) => r.netid));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await bumpVersion("roster");

  return NextResponse.json({
    added: diff.add.length,
    updated: diff.update.length,
    dropped: diff.drop.length,
  });
}
