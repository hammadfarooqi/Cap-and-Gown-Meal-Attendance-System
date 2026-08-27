import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";

export type RosterEntry = {
  netid: string;
  fullName: string;
  classYear: number | null;
  hasPhoto: boolean;
};

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { data, error } = await serviceClient()
    .from("people")
    .select("netid, full_name, class_year, photo_path")
    .eq("is_member", true)
    .order("full_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members: RosterEntry[] = data.map((p) => ({
    netid: p.netid,
    fullName: p.full_name,
    classYear: p.class_year,
    hasPhoto: Boolean(p.photo_path),
  }));

  return NextResponse.json({ members });
}
