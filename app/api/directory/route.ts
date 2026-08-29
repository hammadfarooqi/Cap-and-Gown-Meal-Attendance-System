import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { envelope } from "@/lib/api/envelope";
import { lookupDirectory } from "@/lib/directory/ldap";

/** Needs a socket, so it cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * "Is this a real netID, and what is the person called?"
 *
 * Asked by the station when somebody types a netID it does not recognise —
 * before the form opens, so a netID that cannot exist is refused without
 * anybody filling anything in, and a real one arrives with the name already
 * in the box.
 *
 * Never fails the caller. An unreachable directory answers "unavailable",
 * and the station carries on with an empty name field.
 */
export async function POST(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const netid = typeof body?.netid === "string" ? body.netid : "";

  return NextResponse.json(await envelope(await lookupDirectory(netid)));
}
