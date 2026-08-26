import { describe, it, expect } from "vitest";
import {
  makeSemester, semesterFor, currentSemester, isCurrentSemester,
  parseSemesterId, clampToSemester, semesterCutoff,
} from "./semester";
import { availableWindows, buildWindow } from "./window";

const IN_TERM = new Date("2026-10-15T16:00:00Z");   // Thursday, autumn 2026
const EARLY_TERM = new Date("2026-08-05T16:00:00Z"); // four days into term

describe("semesterFor", () => {
  it("puts August through December in the autumn term", () => {
    expect(semesterFor("2026-08-01")!.id).toBe("fall-2026");
    expect(semesterFor("2026-12-31")!.id).toBe("fall-2026");
  });

  it("puts January through June in the spring term", () => {
    expect(semesterFor("2027-01-01")!.id).toBe("spring-2027");
    expect(semesterFor("2027-06-30")!.id).toBe("spring-2027");
  });

  it("returns nothing for July, when nobody is eating here", () => {
    expect(semesterFor("2027-07-15")).toBeNull();
  });
});

describe("currentSemester", () => {
  it("is the term containing today", () => {
    expect(currentSemester(IN_TERM).id).toBe("fall-2026");
  });

  it("falls back to the term that just ended during July", () => {
    expect(currentSemester(new Date("2027-07-10T16:00:00Z")).id).toBe("spring-2027");
  });
});

describe("parseSemesterId", () => {
  it("round-trips an id", () => {
    expect(parseSemesterId("fall-2026")!.label).toBe("Fall 2026");
  });

  it("rejects anything else", () => {
    expect(parseSemesterId("winter-2026")).toBeNull();
    expect(parseSemesterId("'; drop table swipes; --")).toBeNull();
  });
});

describe("clampToSemester", () => {
  const fall = makeSemester("fall", 2026);

  it("KEEPS A WINDOW FROM REACHING BEFORE TERM STARTED", () => {
    // Thirty days back from 5 August lands in the previous spring. Having
    // scoped to Fall 2026, a reader must never be shown it.
    expect(clampToSemester({ from: "2026-07-07", to: "2026-08-05" }, fall))
      .toEqual({ from: "2026-08-01", to: "2026-08-05" });
  });

  it("keeps a window from reaching past the end of term", () => {
    expect(clampToSemester({ from: "2026-12-20", to: "2027-01-10" }, fall))
      .toEqual({ from: "2026-12-20", to: "2026-12-31" });
  });

  it("leaves a window already inside the term alone", () => {
    const inside = { from: "2026-10-01", to: "2026-10-31" };
    expect(clampToSemester(inside, fall)).toEqual(inside);
  });
});

describe("semesterCutoff", () => {
  it("stops at today while the term is running", () => {
    expect(semesterCutoff(makeSemester("fall", 2026), IN_TERM)).toBe("2026-10-15");
  });

  it("is the end of term once the term is over", () => {
    expect(semesterCutoff(makeSemester("spring", 2026), IN_TERM)).toBe("2026-06-30");
  });
});

describe("availableWindows", () => {
  it("offers the clock-relative windows for the CURRENT semester", () => {
    const windows = availableWindows(makeSemester("fall", 2026), IN_TERM);
    expect(windows).toContain("today");
    expect(windows).toContain("thirty");
  });

  it("WITHHOLDS THEM FOR A PAST SEMESTER", () => {
    // "Today" has no referent inside a term that already ended, and
    // re-anchoring "last 7 days" to its final week would silently change
    // what the words mean.
    const windows = availableWindows(makeSemester("spring", 2026), IN_TERM);
    expect(windows).not.toContain("today");
    expect(windows).not.toContain("seven");
  });

  it("keeps the semester-relative windows in both cases", () => {
    for (const semester of [makeSemester("fall", 2026), makeSemester("spring", 2026)]) {
      const windows = availableWindows(semester, IN_TERM);
      expect(windows).toContain("semester");
      expect(windows).toContain("weekdays");
      expect(windows).toContain("mon");
    }
  });
});

describe("buildWindow", () => {
  const fall = makeSemester("fall", 2026);

  it("builds a relative window ending today", () => {
    expect(buildWindow("seven", fall, IN_TERM).range)
      .toEqual({ from: "2026-10-09", to: "2026-10-15" });
  });

  it("CLAMPS A RELATIVE WINDOW to the start of term", () => {
    expect(buildWindow("thirty", fall, EARLY_TERM).range)
      .toEqual({ from: "2026-08-01", to: "2026-08-05" });
  });

  it("runs the semester window from term start to today", () => {
    expect(buildWindow("semester", fall, IN_TERM).range)
      .toEqual({ from: "2026-08-01", to: "2026-10-15" });
  });

  it("filters weekdays to Monday through Friday", () => {
    expect(buildWindow("weekdays", fall, IN_TERM).days).toEqual([1, 2, 3, 4, 5]);
  });

  it("filters weekends to Saturday and Sunday", () => {
    expect(buildWindow("weekends", fall, IN_TERM).days).toEqual([0, 6]);
  });

  it("filters a single day of the week, across the whole term", () => {
    const monday = buildWindow("mon", fall, IN_TERM);

    expect(monday.days).toEqual([1]);
    expect(monday.range).toEqual({ from: "2026-08-01", to: "2026-10-15" });
    expect(monday.label).toBe("Every Monday");
  });

  it("names the unit the averages divide by", () => {
    expect(buildWindow("mon", fall, IN_TERM).unit).toBe("Monday");
    expect(buildWindow("weekdays", fall, IN_TERM).unit).toBe("weekday");
    expect(buildWindow("seven", fall, IN_TERM).unit).toBe("day");
  });

  it("stops a past semester's windows at the end of that term", () => {
    expect(buildWindow("semester", makeSemester("spring", 2026), IN_TERM).range)
      .toEqual({ from: "2026-01-01", to: "2026-06-30" });
  });
});
