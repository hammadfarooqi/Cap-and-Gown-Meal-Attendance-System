import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope } from "@/lib/api/envelope";

type PersonRow = {
  netid: string;
  full_name: string;
  directory_name: string | null;
  is_member: boolean;
  home_club: string | null;
  photo_path: string | null;
};

/**
 * "Who is this card?" — the only blocking call on the scan path, and it runs
 * once per token per tablet. After the tablet caches the answer, that person
 * resolves locally forever.
 *
 * A 404 here is not an error. It means the token has never been bound, and
 * the tablet should show the member-or-guest prompt.
 */
export async function POST(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  // One token per card: track 1's 15-digit base.
  const token = typeof body?.token === "string" && body.token.length > 0 ? body.token : null;

  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  const db = serviceClient();
  const { data } = await db
    .from("credentials")
    .select("token, people(netid, full_name, directory_name, is_member, home_club, photo_path)")
    .eq("token", token)
    .maybeSingle();

  const person = data?.people as PersonRow | undefined;

  if (!person) {
    return NextResponse.json({ error: "unknown token" }, { status: 404 });
  }

  return NextResponse.json(
    await envelope({
      netid: person.netid,
      fullName: person.full_name,
      directoryName: person.directory_name,
      isMember: person.is_member,
      homeClub: person.home_club,
      photoPath: person.photo_path,
    }),
  );
}
