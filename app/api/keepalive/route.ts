import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/db/client";

/**
 * What replaces the $25/month Supabase Pro upgrade.
 *
 * Supabase pauses a free project after 7 days without a request, and an
 * unpausing takes a couple of minutes and a dashboard login — which would
 * land on the business manager on the first morning back from a break. Any
 * real query resets the timer, so a scheduled ping every few days keeps the
 * project awake for nothing.
 *
 * This is the only part of the system nobody will ever look at, and the only
 * part whose failure is silent until the database has already paused. It
 * returns a real status so the scheduled job fails loudly if the query does.
 */
export async function GET() {
  const { error } = await serviceClient()
    .from("versions")
    .select("resource")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
