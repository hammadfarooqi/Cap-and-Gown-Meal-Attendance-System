import { describe, it, expect } from "vitest";
import { serviceClient } from "@/lib/db/client";
import { deriveMeal } from "./derive";
import type { MealWindow } from "./types";

const db = serviceClient();

async function loadSchedule(): Promise<MealWindow[]> {
  const { data, error } = await db
    .from("meal_schedule")
    .select("day_of_week, period_name, start_time, end_time, grace_minutes");
  if (error) throw error;

  return data.map((w) => ({
    dayOfWeek: w.day_of_week,
    periodName: w.period_name,
    startTime: w.start_time,
    endTime: w.end_time,
    graceMinutes: w.grace_minutes,
  }));
}

const seconds = (hhmmss: string) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
};

describe("the seeded meal schedule", () => {
  it("covers every day of the week", async () => {
    const days = new Set((await loadSchedule()).map((w) => w.dayOfWeek));
    expect([...days].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("has no windows that overlap once grace is applied", async () => {
    // deriveMeal returns the FIRST match, so an overlap makes the answer
    // depend on row order — which the database does not guarantee. Two
    // tablets could then disagree with the server about which meal a scan
    // belongs to. This is the check to run after anyone edits the schedule.
    const schedule = await loadSchedule();
    const overlaps: string[] = [];

    for (let day = 0; day <= 6; day++) {
      const windows = schedule
        .filter((w) => w.dayOfWeek === day)
        .map((w) => ({
          name: w.periodName,
          from: seconds(w.startTime) - w.graceMinutes * 60,
          to: seconds(w.endTime) + w.graceMinutes * 60,
        }))
        .sort((a, b) => a.from - b.from);

      for (let i = 1; i < windows.length; i++) {
        if (windows[i].from <= windows[i - 1].to) {
          overlaps.push(`day ${day}: ${windows[i - 1].name} / ${windows[i].name}`);
        }
      }
    }

    expect(overlaps).toEqual([]);
  });

  it("places a real weekday lunch scan correctly", async () => {
    // Wednesday 2026-09-02 at 12:15 New York.
    const result = deriveMeal(new Date("2026-09-02T16:15:00Z"), await loadSchedule());
    expect(result).toEqual({ mealDate: "2026-09-02", mealPeriod: "lunch" });
  });

  it("places a real weekend brunch scan correctly", async () => {
    // Sunday 2026-09-06 at 12:15 New York.
    const result = deriveMeal(new Date("2026-09-06T16:15:00Z"), await loadSchedule());
    expect(result).toEqual({ mealDate: "2026-09-06", mealPeriod: "brunch" });
  });

  it("finds no meal on a weekday morning before breakfast grace begins", async () => {
    // Wednesday 07:30 New York — breakfast grace opens at 07:45.
    expect(deriveMeal(new Date("2026-09-02T11:30:00Z"), await loadSchedule())).toBeNull();
  });

  it("finds no breakfast at the weekend", async () => {
    // Sunday 08:30 New York — the club serves brunch, not breakfast.
    expect(deriveMeal(new Date("2026-09-06T12:30:00Z"), await loadSchedule())).toBeNull();
  });
});
