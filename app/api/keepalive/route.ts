import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/db/client";

/**
 * What replaces the $25/month Supabase Pro upgrade.
 *
 * IT MUST WRITE. The first version of this endpoint ran a SELECT, returned
 * ok on every scheduled run, and the project paused anyway on 2026-08-25 —
 * seven days after the last real write, having been read three times in
 * between. Supabase's inactivity timer counts database activity, and a read
 * served through PostgREST's pooled connections does not appear to reset it.
 * Their own documentation names "an insert to a ping table" as the remedy.
 *
 * If someone later "simplifies" this back to a read, or to a bare
 * `return { ok: true }`, the database will pause over a break and the first
 * scan back will fail. There are tests for both.
 */
export async function GET() {
  const { data, error } = await serviceClient()
    .from("heartbeat")
    .update({ last_ping: new Date().toISOString() })
    .eq("id", 1)
    .select("last_ping")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, at: data.last_ping });
}
