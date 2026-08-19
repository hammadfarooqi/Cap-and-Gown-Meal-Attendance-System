import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode } from "@/lib/auth/device";

export type DeviceRow = {
  id: string;
  name: string;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { data, error } = await serviceClient()
    .from("devices")
    .select("id, name, enrolled_at, last_seen_at, revoked_at")
    .order("enrolled_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const devices: DeviceRow[] = data.map((d) => ({
    id: d.id,
    name: d.name,
    enrolledAt: d.enrolled_at,
    lastSeenAt: d.last_seen_at,
    revokedAt: d.revoked_at,
  }));

  return NextResponse.json({ devices });
}

export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  return NextResponse.json(await createEnrollmentCode(name));
}
