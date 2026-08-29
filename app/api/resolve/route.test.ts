import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { POST } from "./route";

const db = serviceClient();
const DEVICE = "resolvetest-lane";
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode(DEVICE);
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("people").upsert([
    {
      netid: "res00001",
      full_name: "Resolve Member",
      is_member: true,
      home_club: "Cap & Gown",
      photo_path: "res00001.webp",
    },
    {
      netid: "res00002",
      full_name: "Former Member",
      is_member: false,
      home_club: "None",
      photo_path: "res00002.webp",
    },
  ]);
  // One credential each: credentials.netid is unique as of migration 0007.
  await db.from("credentials").upsert([
    { token: "TOKEN-RES-1", netid: "res00001" },
    { token: "TOKEN-RES-2", netid: "res00002" },
  ]);
});

afterAll(async () => {
  await db.from("credentials").delete().in("netid", ["res00001", "res00002"]);
  await db.from("people").delete().in("netid", ["res00001", "res00002"]);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("POST /api/resolve", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request({ token: "TOKEN-RES-1" }))).status).toBe(401);
  });

  it("returns the person behind a known card token", async () => {
    const res = await POST(request({ token: "TOKEN-RES-1" }, token));
    expect(res.status).toBe(200);

    expect((await res.json()).data).toEqual({
      netid: "res00001",
      fullName: "Resolve Member",
      // Carried so the tablet can match a card printed with the legal name.
      directoryName: null,
      isMember: true,
      homeClub: "Cap & Gown",
      photoPath: "res00001.webp",
    });
  });

  it("resolves a departed member, who can still eat here as a guest", async () => {
    const res = await POST(request({ token: "TOKEN-RES-2" }, token));
    expect(res.status).toBe(200);

    const { isMember, homeClub } = (await res.json()).data;
    expect(isMember).toBe(false);
    expect(homeClub).toBe("None");
  });

  it("returns 404 for a card token nobody has bound", async () => {
    expect((await POST(request({ token: "TOKEN-UNKNOWN" }, token))).status).toBe(404);
  });

  it("returns 400 when the body has no token", async () => {
    expect((await POST(request({}, token))).status).toBe(400);
  });
});
