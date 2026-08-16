import { describe, it, expect } from "vitest";
import { deriveMeal } from "./derive";
import type { MealWindow } from "./types";

// Wednesday 2026-09-02 is dayOfWeek 3.
const WEEKDAY: MealWindow[] = [
  { dayOfWeek: 3, periodName: "breakfast", startTime: "08:00:00", endTime: "10:00:00", graceMinutes: 15 },
  { dayOfWeek: 3, periodName: "lunch",     startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
  { dayOfWeek: 3, periodName: "dinner",    startTime: "18:00:00", endTime: "20:00:00", graceMinutes: 15 },
];

/** Build a UTC instant from a New York wall-clock time during EDT (UTC-4). */
const edt = (isoLocal: string) => new Date(`${isoLocal}-04:00`);

describe("deriveMeal", () => {
  it("places a scan inside a window", () => {
    expect(deriveMeal(edt("2026-09-02T12:00:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan inside the trailing grace period", () => {
    // Spec example: lunch ends 13:30, a 13:39 scan still counts.
    expect(deriveMeal(edt("2026-09-02T13:39:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan inside the leading grace period", () => {
    expect(deriveMeal(edt("2026-09-02T11:20:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("accepts a scan exactly on the grace boundary", () => {
    expect(deriveMeal(edt("2026-09-02T13:45:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("rejects a scan one second past the grace boundary", () => {
    expect(deriveMeal(edt("2026-09-02T13:45:01"), WEEKDAY)).toBeNull();
  });

  it("rejects a scan between meals", () => {
    expect(deriveMeal(edt("2026-09-02T15:00:00"), WEEKDAY)).toBeNull();
  });

  it("rejects a scan on a day with no windows", () => {
    // Sunday 2026-09-06 has dayOfWeek 0, absent from WEEKDAY.
    expect(deriveMeal(edt("2026-09-06T12:00:00"), WEEKDAY)).toBeNull();
  });

  it("uses the New York calendar date, not the UTC date", () => {
    expect(deriveMeal(edt("2026-09-02T19:30:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "dinner" });
  });

  it("does not roll a late dinner onto the next UTC day", () => {
    // 20:10 New York = 00:10 UTC on 2026-09-03. The meal date must stay 09-02.
    expect(deriveMeal(edt("2026-09-02T20:10:00"), WEEKDAY))
      .toEqual({ mealDate: "2026-09-02", mealPeriod: "dinner" });
  });

  it("uses the New York weekday, not the UTC weekday", () => {
    // 20:10 New York on Wednesday is Thursday in UTC. It must still match
    // Wednesday's schedule.
    expect(deriveMeal(edt("2026-09-02T20:10:00"), WEEKDAY)?.mealPeriod).toBe("dinner");
  });

  it("handles a standard-time date after the DST change", () => {
    // 2026-11-18 is a Wednesday in EST (UTC-5).
    const est = new Date("2026-11-18T12:00:00-05:00");
    expect(deriveMeal(est, WEEKDAY))
      .toEqual({ mealDate: "2026-11-18", mealPeriod: "lunch" });
  });

  it("returns the first match when windows overlap after grace is applied", () => {
    const overlapping: MealWindow[] = [
      { dayOfWeek: 3, periodName: "lunch",  startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 60 },
      { dayOfWeek: 3, periodName: "dinner", startTime: "14:00:00", endTime: "16:00:00", graceMinutes: 60 },
    ];
    // 13:45 falls in both. Order in the array decides, deterministically.
    expect(deriveMeal(edt("2026-09-02T13:45:00"), overlapping)?.mealPeriod).toBe("lunch");
  });

  it("gives the same answer regardless of the machine's own timezone", () => {
    // The tablet and the server must agree even if a tablet is misconfigured
    // to a different timezone than the club.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      expect(deriveMeal(edt("2026-09-02T20:10:00"), WEEKDAY))
        .toEqual({ mealDate: "2026-09-02", mealPeriod: "dinner" });
    } finally {
      process.env.TZ = original;
    }
  });
});
