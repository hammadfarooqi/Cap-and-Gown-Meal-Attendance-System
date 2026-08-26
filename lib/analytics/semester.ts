import { clubToday, type DateRange } from "./range";

export type Term = "fall" | "spring";

export type Semester = {
  /** Stable identifier, e.g. "fall-2026". */
  id: string;
  term: Term;
  year: number;
  label: string;
  range: DateRange;
};

/**
 * The club's own definition, kept deliberately coarse: autumn is August
 * through December, spring is January through June. July belongs to neither,
 * because nobody is eating here in July.
 */
export const TERM_MONTHS: Record<Term, { from: string; to: string }> = {
  fall: { from: "08-01", to: "12-31" },
  spring: { from: "01-01", to: "06-30" },
};

export function makeSemester(term: Term, year: number): Semester {
  return {
    id: `${term}-${year}`,
    term,
    year,
    label: `${term === "fall" ? "Fall" : "Spring"} ${year}`,
    range: {
      from: `${year}-${TERM_MONTHS[term].from}`,
      to: `${year}-${TERM_MONTHS[term].to}`,
    },
  };
}

/** The semester containing a date, or null in July. */
export function semesterFor(date: string): Semester | null {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  if (month >= 8) return makeSemester("fall", year);
  if (month <= 6) return makeSemester("spring", year);
  return null;
}

/**
 * The semester to open on. In July there is no current term, so the most
 * recent one — the spring that just ended — is the sensible landing place.
 */
export function currentSemester(now: Date = new Date()): Semester {
  const today = clubToday(now);
  return semesterFor(today) ?? makeSemester("spring", Number(today.slice(0, 4)));
}

export function isCurrentSemester(semester: Semester, now: Date = new Date()): boolean {
  return semester.id === currentSemester(now).id;
}

export function parseSemesterId(id: string): Semester | null {
  const match = /^(fall|spring)-(\d{4})$/.exec(id);
  return match ? makeSemester(match[1] as Term, Number(match[2])) : null;
}

/**
 * Clamp a range so it can never reach outside the semester in view.
 *
 * The semester is the outer scope: having scoped to Fall 2026, no window
 * should quietly show last spring's numbers because "30 days ago" fell
 * before term started.
 */
export function clampToSemester(range: DateRange, semester: Semester): DateRange {
  return {
    from: range.from < semester.range.from ? semester.range.from : range.from,
    to: range.to > semester.range.to ? semester.range.to : range.to,
  };
}

/** The last day of the semester that has actually happened. */
export function semesterCutoff(semester: Semester, now: Date = new Date()): string {
  const today = clubToday(now);
  return today < semester.range.to ? today : semester.range.to;
}
