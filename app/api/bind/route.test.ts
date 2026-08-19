import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { readVersions } from "@/lib/api/envelope";
import { POST } from "./route";

const db = serviceClient();
const DEVICE = "bindtest-lane";
const NETIDS = ["bind0001", "bind0002"];
const TOKENS = ["BIND-CARD-1", "BIND-CARD-2"];
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode(DEVICE);
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("people").upsert([
    { netid: "bind0001", full_name: "Bind One", is_member: true, home_club: "Cap & Gown" },
    { netid: "bind0002", full_name: "Bind Two", is_member: true, home_club: "Cap & Gown" },
  ]);
});

beforeEach(async () => {
  await db.from("credentials").delete().in("token", TOKENS);
});

afterAll(async () => {
  await db.from("credentials").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/bind", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

const boundTo = async (card: string) => {
  const { data } = await db.from("credentials").select("netid").eq("token", card).maybeSingle();
  return data?.netid ?? null;
};

describe("POST /api/bind", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request({ token: TOKENS[0], netid: "bind0001" }))).status).toBe(401);
  });

  it("binds a card to a member", async () => {
    const res = await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));
    expect(res.status).toBe(200);
    expect(await boundTo(TOKENS[0])).toBe("bind0001");
  });

  it("binds a second card to the same member", async () => {
    // A replacement card adds a credential; both must resolve.
    await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));
    await POST(request({ token: TOKENS[1], netid: "bind0001" }, token));

    expect(await boundTo(TOKENS[0])).toBe("bind0001");
    expect(await boundTo(TOKENS[1])).toBe("bind0001");
  });

  it("refuses a netid nobody has heard of, and writes nothing", async () => {
    const res = await POST(request({ token: TOKENS[0], netid: "ghost999" }, token));
    expect(res.status).toBe(404);
    expect(await boundTo(TOKENS[0])).toBeNull();
  });

  it("is idempotent — the same binding sent twice succeeds twice", async () => {
    // The outbox re-sends whole batches, so this has to be free.
    const first = await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));
    const second = await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { count } = await db
      .from("credentials")
      .select("*", { count: "exact", head: true })
      .eq("token", TOKENS[0]);
    expect(count).toBe(1);
  });

  it("refuses to rebind a card, and LEAVES THE EXISTING BINDING ALONE", async () => {
    // Spec section 8: when an offline tablet disagrees, the server keeps its
    // own binding. Asserting the response is 409 is not enough — the point is
    // that the original row does not move.
    await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));

    const res = await POST(request({ token: TOKENS[0], netid: "bind0002" }, token));
    expect(res.status).toBe(409);
    expect(await boundTo(TOKENS[0])).toBe("bind0001");
  });

  it("bumps the roster version so tablets learn about the new card", async () => {
    const before = (await readVersions()).roster;
    await POST(request({ token: TOKENS[0], netid: "bind0001" }, token));
    expect((await readVersions()).roster).toBeGreaterThan(before);
  });

  it("returns 400 when a field is missing", async () => {
    expect((await POST(request({ token: TOKENS[0] }, token))).status).toBe(400);
    expect((await POST(request({ netid: "bind0001" }, token))).status).toBe(400);
  });
});
