import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "@/lib/auth/device";
import { GET } from "./route";

const db = serviceClient();
const DEVICE = "boottest-lane";
let token: string;

beforeAll(async () => {
  const { code } = await createEnrollmentCode(DEVICE);
  token = (await redeemEnrollmentCode(code))!.token;

  await db.from("people").upsert({
    netid: "boot0001",
    full_name: "Bootstrap Member",
    is_member: true,
    home_club: "Cap & Gown",
    photo_path: "boot0001.webp",
  });
  await db.from("credentials").upsert({ token: "TOKEN-BOOT-1", netid: "boot0001" });
  await db.from("meal_schedule").upsert({
    day_of_week: 3,
    period_name: "boot-lunch",
    start_time: "11:30:00",
    end_time: "13:30:00",
    grace_minutes: 15,
  });
});

afterAll(async () => {
  await db.from("credentials").delete().eq("netid", "boot0001");
  await db.from("people").delete().eq("netid", "boot0001");
  await db.from("meal_schedule").delete().eq("period_name", "boot-lunch");

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

const request = (bearer?: string) =>
  new Request("http://localhost/api/bootstrap", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("GET /api/bootstrap", () => {
  it("refuses a request with no device token", async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it("refuses a request with a bad device token", async () => {
    expect((await GET(request("nonsense"))).status).toBe(401);
  });

  it("returns roster, credentials, schedule and versions to an enrolled device", async () => {
    const res = await GET(request(token));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.versions).toEqual({
      roster: expect.any(Number),
      schedule: expect.any(Number),
    });
    expect(body.data.people).toContainEqual(
      expect.objectContaining({ netid: "boot0001", fullName: "Bootstrap Member" }),
    );
    expect(body.data.credentials).toContainEqual({
      token: "TOKEN-BOOT-1",
      netid: "boot0001",
    });
    expect(body.data.schedule).toContainEqual(
      expect.objectContaining({ periodName: "boot-lunch", graceMinutes: 15 }),
    );
  });

  it("returns the schedule in the exact shape deriveMeal consumes", async () => {
    // The tablet feeds this straight into deriveMeal. A rename on either side
    // would silently produce "no meal is running" for every scan.
    const body = await (await GET(request(token))).json();
    const window = body.data.schedule.find(
      (w: { periodName: string }) => w.periodName === "boot-lunch",
    );

    expect(Object.keys(window).sort()).toEqual(
      ["dayOfWeek", "endTime", "graceMinutes", "periodName", "startTime"],
    );
  });
});
