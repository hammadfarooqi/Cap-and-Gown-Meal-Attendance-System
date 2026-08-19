import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope, bumpVersion } from "@/lib/api/envelope";
import { lookupNetid } from "@/lib/directory/lookup";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

type PersonRow = {
  netid: string;
  full_name: string;
  is_member: boolean;
  home_club: string | null;
  photo_path: string | null;
};

const toCached = (p: PersonRow) => ({
  netid: p.netid,
  fullName: p.full_name,
  isMember: p.is_member,
  homeClub: p.home_club,
  photoPath: p.photo_path,
});

/**
 * Record a guest, and bind their card in the same call.
 *
 * If the netID is already known, the existing person is returned untouched.
 * That matters in two directions: a departed member eating as a guest already
 * has a row and their history must stay attached, and a current member whose
 * card was mis-scanned into the guest flow must not be demoted.
 */
export async function POST(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawNetid = typeof body?.netid === "string" ? body.netid : "";
  const homeClub = typeof body?.homeClub === "string" ? body.homeClub : null;
  const token = typeof body?.token === "string" ? body.token : null;

  const directory = await lookupNetid(rawNetid);
  if (!directory || !homeClub) {
    return NextResponse.json({ error: "valid netid and homeClub required" }, { status: 400 });
  }

  const db = serviceClient();
  const netid = directory.netid;

  const { data: existing } = await db
    .from("people")
    .select("netid, full_name, is_member, home_club, photo_path")
    .eq("netid", netid)
    .maybeSingle();

  let person: PersonRow;

  if (existing) {
    person = existing as PersonRow;
  } else {
    const { data: created, error } = await db
      .from("people")
      .insert({
        netid,
        // Until O2 closes there is no name to fetch, so the netID stands in.
        full_name: directory.fullName ?? netid,
        is_member: false,
        home_club: homeClub,
      })
      .select("netid, full_name, is_member, home_club, photo_path")
      .single();

    if (error) {
      const status = error.code === FOREIGN_KEY_VIOLATION ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    person = created as PersonRow;
  }

  if (token) {
    const { error } = await db.from("credentials").insert({ token, netid });
    if (error && error.code !== UNIQUE_VIOLATION) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await bumpVersion("roster");
  return NextResponse.json(await envelope(toCached(person)));
}
