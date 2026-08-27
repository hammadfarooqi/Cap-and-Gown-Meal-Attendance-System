import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";

/**
 * Revoke a tablet.
 *
 * Sets revoked_at rather than deleting the row. Swipes reference station_id,
 * so deleting a device would orphan every scan it ever took — and the whole
 * point of recording which lane took a swipe is being able to look back.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;
  const permanent = new URL(req.url).searchParams.get("permanent") === "true";
  const db = serviceClient();

  if (!permanent) {
    const { error } = await db
      .from("devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ revoked: id });
  }

  // Permanent removal, so the list does not grow forever. Only ever allowed
  // for a tablet that is already revoked AND never recorded a swipe — a
  // mis-typed name, a test device. Anything that took a swipe keeps its row,
  // because those swipes point at it and the record of which lane served
  // somebody is worth more than a tidy list.
  const { data: device } = await db
    .from("devices").select("id, revoked_at").eq("id", id).maybeSingle();

  if (!device) return NextResponse.json({ error: "No such tablet." }, { status: 404 });

  if (!device.revoked_at) {
    return NextResponse.json(
      { error: "Revoke this tablet before removing it." },
      { status: 409 },
    );
  }

  const { count } = await db
    .from("swipes").select("*", { count: "exact", head: true }).eq("station_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `This tablet recorded ${count} meals, so its record is kept.` },
      { status: 409 },
    );
  }

  await db.from("enrollment_codes").delete().eq("device_id", id);
  const { error } = await db.from("devices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ removed: id });
}
