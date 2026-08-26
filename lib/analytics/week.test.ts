import { describe, it, expect } from "vitest";
import { weekStart, currentWeek, layOutWeek, mealColorRole, weekFrom, stepWeek } from "./week";
import type { HeadcountRow } from "./queries";

// 2026-08-25 is a Tuesday. Its week runs Sunday 08-23 to Saturday 08-29.
const TUESDAY = new Date("2026-08-25T16:00:00Z");

const row = (mealDate: string, mealPeriod: string, total: number): HeadcountRow => ({
  mealDate, mealPeriod, total, members: total - 1, guests: 1,
});

describe("weekStart", () => {
  it("returns the Sunday that begins the week", () => {
    expect(weekStart("2026-08-25")).toBe("2026-08-23");
  });

  it("treats Sunday as the start of its own week", () => {
    expect(weekStart("2026-08-23")).toBe("2026-08-23");
  });

  it("keeps Saturday in the week that began six days earlier", () => {
    expect(weekStart("2026-08-29")).toBe("2026-08-23");
  });

  it("crosses a month boundary", () => {
    // 2026-09-01 is a Tuesday; its Sunday is in August.
    expect(weekStart("2026-09-01")).toBe("2026-08-30");
  });

  it("does not drift across the daylight-saving change", () => {
    // The clocks go back on 2026-11-01, a Sunday.
    expect(weekStart("2026-11-04")).toBe("2026-11-01");
  });
});

describe("currentWeek", () => {
  it("spans Sunday to Saturday", () => {
    expect(currentWeek(TUESDAY)).toEqual({ from: "2026-08-23", to: "2026-08-29" });
  });
});

describe("layOutWeek", () => {
  it("ALWAYS RETURNS SEVEN DAYS, Sunday first", () => {
    // A week that redraws itself around whichever days have data cannot be
    // read at a glance or compared against last week.
    const week = layOutWeek([], TUESDAY);

    expect(week).toHaveLength(7);
    expect(week.map((d) => d.weekday)).toEqual([
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]);
  });

  it("gives weekdays three meals and weekends two", () => {
    const week = layOutWeek([], TUESDAY);

    expect(week[0].meals.map((m) => m.mealPeriod)).toEqual(["brunch", "dinner"]);
    expect(week[2].meals.map((m) => m.mealPeriod)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(week[6].meals.map((m) => m.mealPeriod)).toEqual(["brunch", "dinner"]);
  });

  it("fills in the meals that have data", () => {
    const week = layOutWeek(
      [row("2026-08-25", "lunch", 140), row("2026-08-25", "dinner", 90)],
      TUESDAY,
    );

    const tuesday = week[2];
    expect(tuesday.meals.find((m) => m.mealPeriod === "lunch")!.total).toBe(140);
    expect(tuesday.meals.find((m) => m.mealPeriod === "dinner")!.total).toBe(90);
    expect(tuesday.meals.find((m) => m.mealPeriod === "breakfast")!.total).toBe(0);
  });

  it("MARKS DAYS STILL TO COME, so the week keeps its shape as it fills", () => {
    const week = layOutWeek([], TUESDAY);

    expect(week[0].hasHappened).toBe(true);  // Sunday
    expect(week[2].hasHappened).toBe(true);  // Tuesday, today
    expect(week[3].hasHappened).toBe(false); // Wednesday
    expect(week[6].hasHappened).toBe(false); // Saturday
  });

  it("ignores rows from outside this week", () => {
    const week = layOutWeek([row("2026-08-18", "lunch", 999)], TUESDAY);
    expect(week.every((d) => d.meals.every((m) => m.total === 0))).toBe(true);
  });

  it("uses the club's date, not the machine's", () => {
    // 03:00 UTC on Wednesday is still Tuesday evening in New York, so
    // Wednesday has not happened yet.
    const week = layOutWeek([], new Date("2026-08-26T03:00:00Z"));
    expect(week[2].hasHappened).toBe(true);
    expect(week[3].hasHappened).toBe(false);
  });
});

describe("mealColorRole", () => {
  it("GIVES BRUNCH THE SAME COLOUR AS LUNCH", () => {
    // It is the same service on a different day. Colouring them apart makes a
    // reader see a difference between Saturday and Tuesday that is not there.
    expect(mealColorRole("brunch")).toBe("lunch");
    expect(mealColorRole("lunch")).toBe("lunch");
  });

  it("keeps breakfast and dinner distinct", () => {
    expect(mealColorRole("breakfast")).toBe("breakfast");
    expect(mealColorRole("dinner")).toBe("dinner");
  });

  it("falls back to the lunch colour for an unknown service", () => {
    expect(mealColorRole("special-dinner-party")).toBe("lunch");
  });
});

describe("stepWeek", () => {
  const bounds = { earliest: "2026-08-01", latest: "2026-08-25" };

  it("steps back a week", () => {
    expect(stepWeek("2026-08-23", -1, bounds)).toBe("2026-08-16");
  });

  it("REFUSES TO STEP INTO THE FUTURE", () => {
    // This week is the last one there is. Next week has not happened.
    expect(stepWeek("2026-08-23", 1, bounds)).toBeNull();
  });

  it("steps forward when there is a later week to see", () => {
    expect(stepWeek("2026-08-16", 1, bounds)).toBe("2026-08-23");
  });

  it("REFUSES TO STEP BEFORE TERM STARTED", () => {
    // The semester is the outer scope; paging back out of it would show
    // numbers from a term the reader did not select.
    expect(stepWeek("2026-07-26", -1, bounds)).toBeNull();
  });

  it("allows the week containing the first day of term", () => {
    // Term starts Saturday 1 August, whose week begins Sunday 26 July.
    expect(stepWeek("2026-08-02", -1, bounds)).toBe("2026-07-26");
  });
});

describe("weekFrom", () => {
  it("spans the seven days beginning on that Sunday", () => {
    expect(weekFrom("2026-08-23")).toEqual({ from: "2026-08-23", to: "2026-08-29" });
  });
});

describe("layOutWeek with an explicit week", () => {
  it("lays out a past week and marks every day as happened", () => {
    const week = layOutWeek([], TUESDAY, "2026-08-16");

    expect(week[0].date).toBe("2026-08-16");
    expect(week.every((d) => d.hasHappened)).toBe(true);
  });
});
