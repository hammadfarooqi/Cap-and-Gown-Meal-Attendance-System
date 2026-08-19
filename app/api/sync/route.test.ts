import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { POST } from "./route";

const db = serviceClient();
const DEVICE = "synctest-lane";
const NETIDS = ["sync0001", "sync0002"];
let token: string;

// This file inserts its own meal window rather than leaning on the seeded
// schedule, and it must not overlap a real one. deriveMeal returns the first
// match, so an overlapping fixture silently resolves to the real meal instead
// and the assertions drift. 03:00-04:00 is clear of every service hour.
const PERIOD = "synctest-window";

// Wednesday 2026-09-02, 03:30 New York — inside the fixture window.
const IN_WINDOW = "2026-09-02T07:30:00.000Z";
// Wednesday 2026-09-02, 02:00 New York — outside every window, real or fixture.
const OUTSIDE_ANY_MEAL = "2026-09-02T06:00:00.000Z";

beforeAll(async () => {
  const { code } = await createEnrollmentCode(DEVICE);
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("meal_schedule").upsert({
    day_of_week: 3,
    period_name: PERIOD,
    start_time: "03:00:00",
    end_time: "04:00:00",
    grace_minutes: 15,
  });
  await db.from("people").upsert([
    { netid: "sync0001", full_name: "Sync Member", is_member: true, home_club: "Cap & Gown" },
    { netid: "sync0002", full_name: "Sync Guest", is_member: false, home_club: "Cottage" },
  ]);
});

beforeEach(async () => {
  await db.from("swipes").delete().in("netid", NETIDS);
});

afterAll(async () => {
  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);
  await db.from("meal_schedule").delete().eq("period_name", PERIOD);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

const request = (body: unknown, bearer?: string) =>
  new Request("http://localhost/api/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

const oneSwipe = (netid: string, scannedAt = IN_WINDOW) => ({
  swipes: [{ netid, scannedAt, entryMethod: "scan" }],
});

const countFor = async (netid: string) => {
  const { count } = await db
    .from("swipes")
    .select("*", { count: "exact", head: true })
    .eq("netid", netid);
  return count;
};

describe("POST /api/sync", () => {
  it("refuses an unenrolled device", async () => {
    expect((await POST(request(oneSwipe("sync0001")))).status).toBe(401);
  });

  it("records a swipe and derives its meal server-side", async () => {
    const res = await POST(request(oneSwipe("sync0001"), token));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ accepted: 1, skipped: 0 });

    const { data } = await db.from("swipes").select("*").eq("netid", "sync0001").single();
    expect(data!.meal_date).toBe("2026-09-02");
    expect(data!.meal_period).toBe(PERIOD);
  });

  it("is idempotent — sending the same batch three times leaves one row", async () => {
    await POST(request(oneSwipe("sync0001"), token));
    await POST(request(oneSwipe("sync0001"), token));
    const third = await POST(request(oneSwipe("sync0001"), token));

    expect(third.status).toBe(200);
    expect((await third.json()).data).toEqual({ accepted: 0, skipped: 1 });
    expect(await countFor("sync0001")).toBe(1);
  });

  it("keeps the FIRST scan time when a duplicate arrives later", async () => {
    await POST(request(oneSwipe("sync0001", "2026-09-02T07:30:00.000Z"), token));
    await POST(request(oneSwipe("sync0001", "2026-09-02T07:45:00.000Z"), token));

    const { data } = await db
      .from("swipes")
      .select("scanned_at")
      .eq("netid", "sync0001")
      .single();

    // The rush-hour histogram reads scanned_at, so it must be arrival time,
    // not the time of whichever duplicate happened to sync last.
    expect(new Date(data!.scanned_at).toISOString()).toBe("2026-09-02T07:30:00.000Z");
  });

  it("snapshots membership onto the swipe", async () => {
    await POST(request(oneSwipe("sync0002"), token));

    const { data } = await db
      .from("swipes")
      .select("was_member")
      .eq("netid", "sync0002")
      .single();

    expect(data!.was_member).toBe(false);
  });

  it("does not rewrite history when someone's membership later changes", async () => {
    await POST(request(oneSwipe("sync0002"), token));
    await db.from("people").update({ is_member: true }).eq("netid", "sync0002");

    const { data } = await db
      .from("swipes")
      .select("was_member")
      .eq("netid", "sync0002")
      .single();

    expect(data!.was_member).toBe(false);

    await db.from("people").update({ is_member: false }).eq("netid", "sync0002");
  });

  it("skips a scan that falls outside every meal window", async () => {
    const res = await POST(request(oneSwipe("sync0001", OUTSIDE_ANY_MEAL), token));
    expect((await res.json()).data).toEqual({ accepted: 0, skipped: 1 });
    expect(await countFor("sync0001")).toBe(0);
  });

  it("skips a netid nobody has heard of rather than failing the batch", async () => {
    const res = await POST(request({
      swipes: [
        { netid: "ghost999", scannedAt: IN_WINDOW, entryMethod: "scan" },
        { netid: "sync0001", scannedAt: IN_WINDOW, entryMethod: "scan" },
      ],
    }, token));

    expect((await res.json()).data).toEqual({ accepted: 1, skipped: 1 });
    expect(await countFor("sync0001")).toBe(1);
  });

  it("accepts a mixed batch without letting one bad item lose the good ones", async () => {
    const res = await POST(request({
      swipes: [
        { netid: "sync0001", scannedAt: IN_WINDOW, entryMethod: "scan" },
        { netid: "sync0002", scannedAt: OUTSIDE_ANY_MEAL, entryMethod: "scan" },
      ],
    }, token));

    expect((await res.json()).data).toEqual({ accepted: 1, skipped: 1 });
  });

  it("skips an unparseable timestamp instead of throwing", async () => {
    const res = await POST(request({
      swipes: [{ netid: "sync0001", scannedAt: "not a date", entryMethod: "scan" }],
    }, token));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ accepted: 0, skipped: 1 });
  });

  it("records which tablet took the swipe", async () => {
    await POST(request(oneSwipe("sync0001"), token));

    const { data } = await db
      .from("swipes")
      .select("station_id")
      .eq("netid", "sync0001")
      .single();

    expect(data!.station_id).toEqual(expect.any(String));
  });

  it("returns 400 when the body has no swipes array", async () => {
    expect((await POST(request({}, token))).status).toBe(400);
  });
});
