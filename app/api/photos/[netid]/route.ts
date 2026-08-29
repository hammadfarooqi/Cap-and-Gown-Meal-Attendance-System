import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/auth/device";
import { adminOrNull } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { isValidNetid } from "@/lib/directory/netid";

/**
 * Serve a headshot from the private bucket.
 *
 * These are photographs of students, so this is not a public URL. An enrolled
 * tablet may read them, and so may a signed-in officer looking at the roster.
 * Nobody else.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ netid: string }> },
) {
  const allowed = (await authenticateDevice(req)) ?? (await adminOrNull());
  if (!allowed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { netid } = await params;
  if (!isValidNetid(netid)) {
    return NextResponse.json({ error: "bad netid" }, { status: 400 });
  }

  const { data, error } = await serviceClient()
    .storage.from("headshots")
    .download(`${netid.toLowerCase()}.webp`);

  if (error || !data) {
    return NextResponse.json({ error: "no photo" }, { status: 404 });
  }

  return new Response(await data.arrayBuffer(), {
    headers: {
      "content-type": "image/webp",
      // A tablet caches these in IndexedDB anyway; this only helps a
      // dashboard page that renders the same face twice.
      "cache-control": "private, max-age=300",
    },
  });
}
