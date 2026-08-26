import { describe, it, expect } from "vitest";
import { clubToday, shiftDays, semesterStart, presetRange, isValidRange } from "./range";

describe("clubToday", () => {
  it("uses the club's calendar date, not the machine's", () => {
    // 03:00 UTC on 2026-09-03 is 23:00 on 2026-09-02 in New York. The
    // business manager checking "today" at 11pm must see the 2nd.
    expect(clubToday(new Date("2026-09-03T03:00:00Z"))).toBe("2026-09-02");
  });

  it("rolls over at New York midnight, not UTC midnight", () => {
    expect(clubToday(new Date("2026-09-03T03:59:00Z"))).toBe("2026-09-02");
    expect(clubToday(new Date("2026-09-03T04:01:00Z"))).toBe("2026-09-03");
  });

  it("handles standard time as well as daylight time", () => {
    // In November New York is UTC-5, so the boundary moves an hour.
    expect(clubToday(new Date("2026-11-18T04:59:00Z"))).toBe("2026-11-17");
    expect(clubToday(new Date("2026-11-18T05:01:00Z"))).toBe("2026-11-18");
  });
});

describe("shiftDays", () => {
  it("moves backwards and forwards", () => {
    expect(shiftDays("2026-09-02", -1)).toBe("2026-09-01");
    expect(shiftDays("2026-09-02", 1)).toBe("2026-09-03");
  });

  it("crosses a month boundary", () => {
    expect(shiftDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    expect(shiftDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("does not drift across a daylight-saving change", () => {
    // The clocks go back on 2026-11-01. Naive date arithmetic loses an hour
    // here and can land on the wrong day.
    expect(shiftDays("2026-11-02", -1)).toBe("2026-11-01");
    expect(shiftDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});

describe("semesterStart", () => {
  it("returns 1 September during the autumn term", () => {
    expect(semesterStart("2026-10-15")).toBe("2026-09-01");
  });

  it("returns 15 January during the spring term", () => {
    expect(semesterStart("2027-03-01")).toBe("2027-01-15");
  });

  it("looks back to the previous autumn in early January", () => {
    // Someone pulling numbers on 5 January wants the term that just ended,
    // not a range that starts ten days in the future.
    expect(semesterStart("2027-01-05")).toBe("2026-09-01");
  });

  it("treats 1 September itself as the start of the autumn term", () => {
    expect(semesterStart("2026-09-01")).toBe("2026-09-01");
  });

  it("treats 31 August as still belonging to the previous term", () => {
    expect(semesterStart("2026-08-31")).toBe("2026-01-15");
  });
});

describe("presetRange", () => {
  const at = new Date("2026-10-15T16:00:00Z"); // noon in New York

  it("today is a single day", () => {
    expect(presetRange("today", at)).toEqual({ from: "2026-10-15", to: "2026-10-15" });
  });

  it("three covers three days including today", () => {
    expect(presetRange("three", at)).toEqual({ from: "2026-10-13", to: "2026-10-15" });
  });

  it("week covers seven days including today", () => {
    expect(presetRange("week", at)).toEqual({ from: "2026-10-09", to: "2026-10-15" });
  });

  it("month covers thirty days including today", () => {
    expect(presetRange("month", at)).toEqual({ from: "2026-09-16", to: "2026-10-15" });
  });

  it("semester runs from the start of term", () => {
    expect(presetRange("semester", at)).toEqual({ from: "2026-09-01", to: "2026-10-15" });
  });
});

describe("isValidRange", () => {
  it("accepts a well-formed range", () => {
    expect(isValidRange({ from: "2026-09-01", to: "2026-09-30" })).toBe(true);
  });

  it("accepts a single day", () => {
    expect(isValidRange({ from: "2026-09-01", to: "2026-09-01" })).toBe(true);
  });

  it("rejects a backwards range", () => {
    expect(isValidRange({ from: "2026-09-30", to: "2026-09-01" })).toBe(false);
  });

  it.each([
    ["", "empty"],
    ["01/09/2026", "the wrong format"],
    ["2026-9-1", "unpadded"],
    ["'; drop table swipes; --", "an injection attempt"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidRange({ from: value, to: "2026-09-30" })).toBe(false);
  });
});
