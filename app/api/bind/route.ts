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
  const token = typeof body?.token === "string" ? body.token : null;
  const netid = typeof body?.netid === "string" ? body.netid : null;
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

  const { error } = await db.from("credentials").insert({ token, netid });

  if (!error) {
    await bumpVersion("roster");
    return NextResponse.json(await envelope({ token, netid }));
  }

  if (error.code !== UNIQUE_VIOLATION) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: existing } = await db
    .from("credentials")
    .select("netid")
    .eq("token", token)
    .maybeSingle();

  if (existing?.netid === netid) {
    // Same binding, sent twice. Re-sending is meant to be free.
    return NextResponse.json(await envelope({ token, netid }));
  }

  return NextResponse.json(
    { error: "token already bound to a different person", boundTo: existing?.netid },
    { status: 409 },
  );
}
