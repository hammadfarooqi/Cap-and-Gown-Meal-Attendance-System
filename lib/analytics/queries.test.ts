import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient } from "@/lib/db/client";
import {
  dailyHeadcount, rushHistogram, todayCounts, guestsByClub, swipeRows,
  averagePerServedDay,
} from "./queries";
import { clubToday } from "./range";

const db = serviceClient();

const MEMBER = "anaaaa01";
const MEMBER2 = "anaaaa02";
const GUEST_COTTAGE = "angggg01";
const GUEST_TOWER = "angggg02";
const NETIDS = [MEMBER, MEMBER2, GUEST_COTTAGE, GUEST_TOWER];

/** New York noon on a given day, expressed as the UTC instant to store. */
const nyNoon = (date: string) => `${date}T16:00:00.000Z`;
/** New York 12:20 — a later arrival in the same meal. */
const nyLate = (date: string) => `${date}T16:20:00.000Z`;

const swipe = (
  netid: string,
  mealDate: string,
  mealPeriod: string,
  wasMember: boolean,
  scannedAt: string,
) => ({
  netid, meal_date: mealDate, meal_period: mealPeriod,
  was_member: wasMember, scanned_at: scannedAt, entry_method: "scan",
});

beforeAll(async () => {
  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);

  await db.from("people").insert([
    { netid: MEMBER, full_name: "Anna Member", is_member: true, home_club: "Cap & Gown" },
    { netid: MEMBER2, full_name: "Second Member", is_member: true, home_club: "Cap & Gown" },
    { netid: GUEST_COTTAGE, full_name: "Cottage Guest", is_member: false, home_club: "Cottage" },
    { netid: GUEST_TOWER, full_name: "Tower Guest", is_member: false, home_club: "Tower" },
  ]);

  await db.from("swipes").insert([
    // 2026-10-05: two members and one guest at lunch, one member at dinner.
    swipe(MEMBER, "2026-10-05", "lunch", true, nyNoon("2026-10-05")),
    swipe(MEMBER2, "2026-10-05", "lunch", true, nyLate("2026-10-05")),
    swipe(GUEST_COTTAGE, "2026-10-05", "lunch", false, nyNoon("2026-10-05")),
    swipe(MEMBER, "2026-10-05", "dinner", true, `2026-10-05T23:00:00.000Z`),

    // 2026-10-06: one member and one guest at lunch.
    swipe(MEMBER, "2026-10-06", "lunch", true, nyNoon("2026-10-06")),
    swipe(GUEST_TOWER, "2026-10-06", "lunch", false, nyNoon("2026-10-06")),

    // 2026-10-07: nothing at all — a closed day.

    // 2026-10-08: one member at lunch. Boundary of the test range.
    swipe(MEMBER, "2026-10-08", "lunch", true, nyNoon("2026-10-08")),

    // Outside the range on both sides.
    swipe(MEMBER, "2026-10-04", "lunch", true, nyNoon("2026-10-04")),
    swipe(MEMBER, "2026-10-09", "lunch", true, nyNoon("2026-10-09")),
  ]);
});

afterAll(async () => {
  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);
});

const RANGE = { from: "2026-10-05", to: "2026-10-08" };

describe("dailyHeadcount", () => {
  it("splits members and guests per meal per day", async () => {
    const rows = await dailyHeadcount(RANGE);
    const lunch5 = rows.find((r) => r.mealDate === "2026-10-05" && r.mealPeriod === "lunch");

    expect(lunch5).toEqual({
      mealDate: "2026-10-05", mealPeriod: "lunch",
      total: 3, members: 2, guests: 1,
    });
  });

  it("includes both ends of the range", async () => {
    const rows = await dailyHeadcount(RANGE);
    const dates = new Set(rows.map((r) => r.mealDate));

    expect(dates.has("2026-10-05")).toBe(true);
    expect(dates.has("2026-10-08")).toBe(true);
    expect(dates.has("2026-10-04")).toBe(false);
    expect(dates.has("2026-10-09")).toBe(false);
  });

  it("OMITS a day with no swipes rather than reporting zero", async () => {
    // This is what makes deferring schedule exceptions safe. A closed day
    // vanishes on its own, so averages over days present stay honest.
    const rows = await dailyHeadcount(RANGE);
    expect(rows.some((r) => r.mealDate === "2026-10-07")).toBe(false);
  });

  it("USES was_member, so a later membership change cannot rewrite history", async () => {
    await db.from("people").update({ is_member: true }).eq("netid", GUEST_COTTAGE);
    try {
      const rows = await dailyHeadcount(RANGE);
      const lunch5 = rows.find((r) => r.mealDate === "2026-10-05" && r.mealPeriod === "lunch");
      expect(lunch5!.guests).toBe(1);
    } finally {
      await db.from("people").update({ is_member: false }).eq("netid", GUEST_COTTAGE);
    }
  });

  it("returns an empty list for a range with nothing in it", async () => {
    expect(await dailyHeadcount({ from: "2020-01-01", to: "2020-01-31" })).toEqual([]);
  });
});

describe("rushHistogram", () => {
  it("separates the meals rather than putting them on one long axis", async () => {
    // Lunch and dinner six hours apart on a single axis is mostly empty
    // space. Each meal is its own small multiple.
    const buckets = await rushHistogram(RANGE, 5);
    expect(new Set(buckets.map((b) => b.mealPeriod))).toEqual(new Set(["lunch", "dinner"]));
  });

  it("buckets by New York minute-of-day", async () => {
    // Noon in New York is minute 720. Getting the timezone wrong puts it at
    // 960 or 1020 and every peak reads four hours late.
    const buckets = await rushHistogram(RANGE, 5);
    const lunch = buckets.filter((b) => b.mealPeriod === "lunch");
    expect(lunch.find((b) => b.minuteOfDay === 720)?.total).toBeGreaterThan(0);
  });

  it("separates arrivals twenty minutes apart", async () => {
    const buckets = await rushHistogram(RANGE, 5);
    const lunch = buckets.filter((b) => b.mealPeriod === "lunch");
    expect(lunch.find((b) => b.minuteOfDay === 740)?.total).toBe(1);
  });

  it("honours the bucket width", async () => {
    const fine = await rushHistogram(RANGE, 5);
    const coarse = await rushHistogram(RANGE, 60);

    expect(coarse.length).toBeLessThan(fine.length);
    expect(coarse.every((b) => b.minuteOfDay % 60 === 0)).toBe(true);
  });

  it("returns nothing for an empty range", async () => {
    expect(await rushHistogram({ from: "2020-01-01", to: "2020-01-31" })).toEqual([]);
  });
});

describe("todayCounts", () => {
  it("counts only the club's today", async () => {
    const today = clubToday();
    await db.from("swipes").insert(
      swipe(MEMBER2, today, "todaytest", true, new Date().toISOString()),
    );

    try {
      const counts = await todayCounts();
      expect(counts.find((c) => c.mealPeriod === "todaytest")).toEqual({
        mealPeriod: "todaytest", total: 1, members: 1, guests: 0,
      });
    } finally {
      await db.from("swipes").delete().eq("meal_period", "todaytest");
    }
  });

  it("returns nothing when nobody has eaten today", async () => {
    const counts = await todayCounts();
    expect(counts.every((c) => c.mealPeriod !== "todaytest")).toBe(true);
  });
});

describe("guestsByClub", () => {
  it("groups guests by their home club", async () => {
    const rows = await guestsByClub(RANGE);

    expect(rows.find((r) => r.homeClub === "Cottage")).toEqual({
      homeClub: "Cottage", visits: 1, people: 1,
    });
    expect(rows.find((r) => r.homeClub === "Tower")).toEqual({
      homeClub: "Tower", visits: 1, people: 1,
    });
  });

  it("excludes members entirely", async () => {
    const rows = await guestsByClub(RANGE);
    expect(rows.find((r) => r.homeClub === "Cap & Gown")).toBeUndefined();
  });

  it("counts visits and distinct people separately", async () => {
    // Someone who comes twice is two visits and one person.
    await db.from("swipes").insert(
      swipe(GUEST_COTTAGE, "2026-10-06", "lunch", false, nyNoon("2026-10-06")),
    );

    try {
      const cottage = (await guestsByClub(RANGE)).find((r) => r.homeClub === "Cottage");
      expect(cottage).toEqual({ homeClub: "Cottage", visits: 2, people: 1 });
    } finally {
      await db.from("swipes").delete().eq("netid", GUEST_COTTAGE).eq("meal_date", "2026-10-06");
    }
  });
});

describe("swipeRows", () => {
  it("returns one row per swipe with the person joined on", async () => {
    const rows = await swipeRows(RANGE);
    const row = rows.find((r) => r.netid === GUEST_COTTAGE);

    expect(row).toMatchObject({
      netid: GUEST_COTTAGE,
      fullName: "Cottage Guest",
      wasMember: false,
      homeClub: "Cottage",
      mealDate: "2026-10-05",
      mealPeriod: "lunch",
    });
  });

  it("reports the scan time in New York, not UTC", async () => {
    const rows = await swipeRows(RANGE);
    const row = rows.find((r) => r.netid === GUEST_COTTAGE)!;

    // Stored as 16:00Z, which is noon in New York.
    expect(row.scannedAtLocal).toContain("12:00:00");
  });

  it("stays inside the range", async () => {
    const dates = new Set((await swipeRows(RANGE)).map((r) => r.mealDate));
    expect(dates.has("2026-10-04")).toBe(false);
    expect(dates.has("2026-10-09")).toBe(false);
  });
});

describe("averagePerServedDay", () => {
  it("DIVIDES BY DAYS THAT HAD SWIPES, not by calendar days", async () => {
    // Lunch ran on the 5th (3), the 6th (2) and the 8th (1) — six covers
    // across three days served. The 7th was closed. Dividing by the four
    // calendar days in the range would report 1.5 instead of 2.0, quietly
    // understating every range that spans a break.
    const averages = averagePerServedDay(await dailyHeadcount(RANGE));
    const lunch = averages.find((a) => a.mealPeriod === "lunch");

    expect(lunch!.average).toBe(2);
    expect(lunch!.average).not.toBe(6 / 4);
  });

  it("ORDERS SERVICES CHRONOLOGICALLY, not alphabetically", async () => {
    // Alphabetical puts brunch above dinner above lunch, which reads as
    // nonsense to anyone thinking about a day.
    const averages = averagePerServedDay([
      { mealDate: "2026-10-05", mealPeriod: "dinner", total: 5, members: 5, guests: 0 },
      { mealDate: "2026-10-05", mealPeriod: "breakfast", total: 5, members: 5, guests: 0 },
      { mealDate: "2026-10-05", mealPeriod: "lunch", total: 5, members: 5, guests: 0 },
    ]);

    expect(averages.map((a) => a.mealPeriod)).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("returns zero rather than dividing by nothing", () => {
    expect(averagePerServedDay([])).toEqual([]);
  });
});
