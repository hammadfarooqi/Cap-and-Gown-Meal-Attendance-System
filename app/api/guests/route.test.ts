import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { readVersions } from "@/lib/api/envelope";
import { POST } from "./route";

const db = serviceClient();
const DEVICE = "guesttest-lane";
const GUEST = "guest001";
const EXMEMBER = "exmem001";
const MEMBER = "curmem01";
const CARD = "GUEST-CARD-1";
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode(DEVICE);
  token = (await redeemEnrollmentCode(code))!.token;
});

beforeEach(async () => {
  await db.from("credentials").delete().eq("token", CARD);
  await db.from("people").delete().in("netid", [GUEST, EXMEMBER, MEMBER]);

  // A departed member: still a person, no longer a member, no club.
  await db.from("people").insert({
    netid: EXMEMBER, full_name: "Departed Member", is_member: false, home_club: "None",
  });
  // A current member, to prove the guest flow cannot demote one.
  await db.from("people").insert({
    netid: MEMBER, full_name: "Current Member", is_member: true, home_club: "Cap & Gown",
  });
});

afterAll(async () => {
  await db.from("credentials").delete().eq("token", CARD);
  await db.from("people").delete().in("netid", [GUEST, EXMEMBER, MEMBER]);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/guests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

const personRow = async (netid: string) => {
  const { data } = await db
    .from("people").select("*").eq("netid", netid).maybeSingle();
  return data;
};

describe("POST /api/guests", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request({ netid: GUEST, homeClub: "Cottage" }))).status).toBe(401);
  });

  it("creates a guest as a non-member with their home club", async () => {
    const res = await POST(request({ netid: GUEST, homeClub: "Cottage" }, token));
    expect(res.status).toBe(200);

    const row = await personRow(GUEST);
    expect(row!.is_member).toBe(false);
    expect(row!.home_club).toBe("Cottage");
  });

  it("binds the card in the same call", async () => {
    await POST(request({ netid: GUEST, homeClub: "Cottage", token: CARD }, token));

    const { data } = await db
      .from("credentials").select("netid").eq("token", CARD).maybeSingle();
    expect(data!.netid).toBe(GUEST);
  });

  it("rejects a malformed netid and writes nothing", async () => {
    const res = await POST(request({ netid: "not a netid", homeClub: "Cottage" }, token));
    expect(res.status).toBe(400);
    expect(await personRow("not a netid")).toBeNull();
  });

  it("rejects a club that is not in the clubs table", async () => {
    const res = await POST(request({ netid: GUEST, homeClub: "Hogwarts" }, token));
    expect(res.status).toBe(400);
    expect(await personRow(GUEST)).toBeNull();
  });

  it("accepts 'None', which records the absence of a club", async () => {
    const res = await POST(request({ netid: GUEST, homeClub: "None" }, token));
    expect(res.status).toBe(200);
    expect((await personRow(GUEST))!.home_club).toBe("None");
  });

  it("returns a departed member untouched instead of creating a duplicate", async () => {
    // They already exist. Their name and history must survive the guest flow.
    const res = await POST(request({ netid: EXMEMBER, homeClub: "Cottage" }, token));
    expect(res.status).toBe(200);

    const row = await personRow(EXMEMBER);
    expect(row!.full_name).toBe("Departed Member");
    expect(row!.home_club).toBe("None");

    const { count } = await db
      .from("people").select("*", { count: "exact", head: true }).eq("netid", EXMEMBER);
    expect(count).toBe(1);
  });

  it("does NOT demote a current member scanned into the guest flow", async () => {
    // Operator error at the prompt must not cost someone their membership.
    await POST(request({ netid: MEMBER, homeClub: "Cottage" }, token));

    const row = await personRow(MEMBER);
    expect(row!.is_member).toBe(true);
    expect(row!.home_club).toBe("Cap & Gown");
  });

  it("normalises a netid typed in capitals", async () => {
    await POST(request({ netid: GUEST.toUpperCase(), homeClub: "Cottage" }, token));
    expect(await personRow(GUEST)).not.toBeNull();
  });

  it("bumps the roster version", async () => {
    const before = (await readVersions()).roster;
    await POST(request({ netid: GUEST, homeClub: "Cottage" }, token));
    expect((await readVersions()).roster).toBeGreaterThan(before);
  });
});
