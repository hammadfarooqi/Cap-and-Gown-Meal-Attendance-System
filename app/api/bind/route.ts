import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { serviceClient } from "@/lib/db/client";
import { envelope, bumpVersion } from "@/lib/api/envelope";

const UNIQUE_VIOLATION = "23505";

/**
 * Bind a card token to a person.
 *
 * Called after the operator answers the unknown-card prompt, and again from
 * the outbox for bindings a tablet made while offline.
 *
 * Re-sending an identical binding must be free, for the same reason it is on
 * /api/sync: a tablet that drops mid-flush simply sends the batch again. But
 * a binding that contradicts an existing one is refused, and the existing one
 * is left alone — see spec section 8. That case only arises from operator
 * error at the prompt, which no protocol can prevent.
 */
export async function POST(req: Request) {
  if (!(await authenticateDevice(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const netid = typeof body?.netid === "string" ? body.netid : null;

  // One token per card: track 1's 15-digit base.
  const token = typeof body?.token === "string" && body.token.length > 0 ? body.token : null;

  if (!token || !netid) {
    return NextResponse.json({ error: "token and netid required" }, { status: 400 });
  }

  const db = serviceClient();

  const { data: person } = await db
    .from("people")
    .select("netid")
    .eq("netid", netid)
    .maybeSingle();

  if (!person) {
    return NextResponse.json({ error: "unknown netid" }, { status: 404 });
  }

  // One person, one card. The unique index on credentials.netid enforces this
  // underneath, but it would surface as a 500 — and the tablet needs an answer
  // it can put on screen for the person standing there. Spec section 8.
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

  // Spec section 8: the server keeps its own answer. An offline tablet that
  // disagrees about whose card this is does not get to overwrite it.
  const { data: existing } = await db
    .from("credentials")
    .select("netid")
    .eq("token", token)
    .maybeSingle();

  if (existing && existing.netid !== netid) {
    return NextResponse.json(
      { error: "token already bound to a different person", boundTo: existing.netid },
      { status: 409 },
    );
  }

  if (!existing) {
    const { error } = await db.from("credentials").insert({ token, netid });

    // A duplicate here means a concurrent identical bind, which is success.
    if (error && error.code !== UNIQUE_VIOLATION) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await bumpVersion("roster");
  }

  return NextResponse.json(await envelope({ token, netid }));
}
