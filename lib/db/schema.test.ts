import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "./client";

const db = serviceClient();
const NETID = "test0001";

beforeAll(async () => {
  await db.from("people").upsert({
    netid: NETID,
    full_name: "Schema Test",
    is_member: true,
    home_club: "Cap & Gown",
  });
});

afterAll(async () => {
  await db.from("swipes").delete().eq("netid", NETID);
  await db.from("people").delete().eq("netid", NETID);
});

describe("swipes primary key", () => {
  it("rejects a second swipe for the same person, date and meal", async () => {
    const row = {
      netid: NETID,
      meal_date: "2026-09-02",
      meal_period: "lunch",
      was_member: true,
      scanned_at: "2026-09-02T16:00:00Z",
      entry_method: "scan",
    };

    const first = await db.from("swipes").insert(row);
    expect(first.error).toBeNull();

    const second = await db.from("swipes").insert(row);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23505"); // unique_violation
  });

  it("allows the same person at a different meal on the same day", async () => {
    const base = {
      netid: NETID,
      meal_date: "2026-09-03",
      was_member: true,
      scanned_at: "2026-09-03T16:00:00Z",
      entry_method: "scan",
    };

    const lunch = await db.from("swipes").insert({ ...base, meal_period: "lunch" });
    const dinner = await db.from("swipes").insert({ ...base, meal_period: "dinner" });

    expect(lunch.error).toBeNull();
    expect(dinner.error).toBeNull();
  });
});
