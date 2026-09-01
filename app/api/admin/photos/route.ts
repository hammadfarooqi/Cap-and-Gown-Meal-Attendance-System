import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/admin";
import { serviceClient } from "@/lib/db/client";
import { bumpVersion } from "@/lib/api/envelope";
import { isValidNetid } from "@/lib/directory/netid";

/**
 * Store one already-processed headshot.
 *
 * The browser resizes and re-encodes before uploading, so nothing here
 * decodes an image. That keeps a heavy image library out of the dependency
 * list and off the serverless function's memory budget, and it means a
 * 300-photo upload sends about 12MB rather than several hundred.
 */
export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const netid = String(form?.get("netid") ?? "").trim().toLowerCase();
  const file = form?.get("photo");

  if (!isValidNetid(netid) || !(file instanceof File)) {
    return NextResponse.json({ error: "A netID and a photo are required." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "That is not an image." }, { status: 400 });
  }

  const db = serviceClient();

  const { data: person } = await db
    .from("people").select("netid").eq("netid", netid).maybeSingle();
  if (!person) {
    return NextResponse.json({ error: `Nobody on the roster has the netID ${netid}.` }, { status: 404 });
  }

  const path = `${netid}.webp`;

  const { error: uploadError } = await db.storage
    .from("headshots")
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Versioned so the tablets notice. They cache photos by this string, so a
  // path that does not change when the image does means a replaced headshot
  // never reaches them again.
  const versionedPath = `${path}?v=${Date.now()}`;

  const { error } = await db.from("people").update({ photo_path: versionedPath }).eq("netid", netid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Tablets fetch the new headshot on their next sync.
  await bumpVersion("roster");

  return NextResponse.json({ netid, path });
}
