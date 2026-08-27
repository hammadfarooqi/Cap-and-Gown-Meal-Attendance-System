import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createEnrollmentCode, redeemEnrollmentCode } from "../lib/auth/device";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const NETID = "photo001";
const DEVICE = "phototest-lane";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

/** A tiny but genuine WebP, so the bucket's MIME rules are exercised. */
const WEBP = Buffer.from(
  "UklGRiIAAABXRUJQVlA4TBUAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
  "base64",
);

async function purge() {
  await db.storage.from("headshots").remove([`${NETID}.webp`]).catch(() => {});
  await db.from("people").delete().eq("netid", NETID);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
}

test.beforeEach(async () => {
  await purge();
  await db.from("people").insert({
    netid: NETID, full_name: "Photo Person", is_member: true, home_club: "Cap & Gown",
  });
  await db.storage.from("headshots").upload(`${NETID}.webp`, WEBP, {
    contentType: "image/webp", upsert: true,
  });
  await db.from("people").update({ photo_path: `${NETID}.webp` }).eq("netid", NETID);
});

test.afterEach(purge);

test("THE BUCKET IS PRIVATE — a public storage URL does not serve a student's face", async ({
  request,
}) => {
  // The whole reason reads go through an authenticated route. A public bucket
  // would put all 196 faces behind a guessable URL.
  const res = await request.get(
    `${SUPABASE_URL}/storage/v1/object/public/headshots/${NETID}.webp`,
  );
  expect(res.ok()).toBe(false);
});

test("an unauthenticated request for a photo is refused", async ({ request }) => {
  const res = await request.get(`/api/photos/${NETID}`);
  expect(res.status()).toBe(401);
});

test("an enrolled tablet can read a photo", async ({ request }) => {
  const { code } = await createEnrollmentCode(DEVICE);
  const { token } = (await redeemEnrollmentCode(code))!;

  const res = await request.get(`/api/photos/${NETID}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/webp");
  expect((await res.body()).length).toBeGreaterThan(0);
});

test("a revoked tablet cannot", async ({ request }) => {
  const { code } = await createEnrollmentCode(DEVICE);
  const enrolled = (await redeemEnrollmentCode(code))!;
  await db.from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", enrolled.deviceId);

  const res = await request.get(`/api/photos/${NETID}`, {
    headers: { authorization: `Bearer ${enrolled.token}` },
  });

  expect(res.status()).toBe(401);
});

test("a member with no photo gives a clean 404, not an error", async ({ request }) => {
  const { code } = await createEnrollmentCode(DEVICE);
  const { token } = (await redeemEnrollmentCode(code))!;

  const res = await request.get("/api/photos/nobody99", {
    headers: { authorization: `Bearer ${token}` },
  });

  // Missing headshots are ordinary — the station falls back to initials.
  expect(res.status()).toBe(404);
});
