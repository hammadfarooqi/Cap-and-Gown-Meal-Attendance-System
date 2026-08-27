import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { bumpVersion } from "@/lib/api/envelope";
import { isValidNetid } from "@/lib/directory/lookup";

/** Add or correct one person. Faster than a file for the single typo that is
 *  most of what actually happens during term. */
export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const netid = typeof body?.netid === "string" ? body.netid.trim().toLowerCase() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const classYear = Number.isInteger(body?.classYear) ? body.classYear : null;

  if (!isValidNetid(netid) || !fullName) {
    return NextResponse.json({ error: "A valid netID and a name are required." }, { status: 400 });
  }

  const { error } = await serviceClient().from("people").upsert(
    { netid, full_name: fullName, class_year: classYear, is_member: true, home_club: "Cap & Gown" },
    { onConflict: "netid" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await bumpVersion("roster");
  return NextResponse.json({ netid });
}

/** Remove one person from the club. Sets is_member false; never deletes. */
export async function DELETE(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const netid = new URL(req.url).searchParams.get("netid")?.trim().toLowerCase() ?? "";
  if (!isValidNetid(netid)) {
    return NextResponse.json({ error: "A valid netID is required." }, { status: 400 });
  }

  const { error } = await serviceClient()
    .from("people")
    .update({ is_member: false, home_club: "None" })
    .eq("netid", netid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await bumpVersion("roster");
  return NextResponse.json({ netid });
}
