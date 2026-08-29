import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope, bumpVersion } from "@/lib/api/envelope";
import { normaliseNetid } from "@/lib/directory/netid";
import { lookupDirectory } from "@/lib/directory/ldap";

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

  // The stripe's name, e.g. ["ALICE","BROWNING"]. Used ONLY when creating
  // somebody: an existing person keeps the name they already have, so a
  // member mis-read into this flow is never renamed by their own card and a
  // departed member keeps the name their swipe history hangs off.
  const cardName: string[] = Array.isArray(body?.cardName)
    ? body.cardName.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
    : [];

  /** What a human typed or accepted in the form's name box. */
  const typedName = typeof body?.fullName === "string" ? body.fullName.trim() : "";

  /** "ALICE/BROWNING" -> "Alice Browning". */
  const nameFromCard = cardName
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

  const netid = normaliseNetid(rawNetid);
  if (!netid || !homeClub) {
    return NextResponse.json({ error: "valid netid and homeClub required" }, { status: 400 });
  }

  const db = serviceClient();

  const { data: existing } = await db
    .from("people")
    .select("netid, full_name, is_member, home_club, photo_path")
    .eq("netid", netid)
    .maybeSingle();

  let person: PersonRow;

  if (existing) {
    person = existing as PersonRow;
  } else {
    // Only ask the directory about somebody we are about to invent. A member
    // or a returning guest is already known, and a lookup would be latency
    // spent to learn nothing.
    const directory = await lookupDirectory(netid);

    // "No such netID" is the one answer allowed to refuse a person, and it is
    // what stops a well-formed typo — hf4899 for hf4888 — becoming a phantom
    // guest that no later query can tell from a real one. A directory that is
    // merely unreachable refuses nobody.
    if (directory.status === "absent") {
      return NextResponse.json(
        { error: "no such netID", netid },
        { status: 422 },
      );
    }

    const directoryName = directory.status === "found" ? directory.fullName : null;

    const { data: created, error } = await db
      .from("people")
      .insert({
        netid,
        // What a human saw and accepted wins, because they were looking at
        // the person. Then the directory, then the card's stripe, then the
        // netID itself.
        full_name: typedName || directoryName || nameFromCard || netid,
        directory_name: directoryName,
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
    // One person, one card. This is the only place the officer message comes
    // from: somebody typed a netID and that person is already bound, which
    // means either a replacement card or the wrong netID. Neither is safe to
    // guess at, so it stops here. Spec section 8.
    const { data: heldByPerson } = await db
      .from("credentials")
      .select("token")
      .eq("netid", netid)
      .maybeSingle();

    if (heldByPerson && heldByPerson.token !== token) {
      return NextResponse.json(
        { error: "person already has a card", boundTo: netid },
        { status: 409 },
      );
    }

    const { error } = await db.from("credentials").insert({ token, netid });
    if (error && error.code !== UNIQUE_VIOLATION) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await bumpVersion("roster");
  return NextResponse.json(await envelope(toCached(person)));
}
