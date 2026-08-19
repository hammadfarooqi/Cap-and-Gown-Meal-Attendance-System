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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { id } = await params;

  const { error } = await serviceClient()
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ revoked: id });
}
