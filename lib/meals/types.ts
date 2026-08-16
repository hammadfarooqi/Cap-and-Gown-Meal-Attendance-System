/** One meal window, as stored in `meal_schedule`. */
export type MealWindow = {
  /** 0 = Sunday, matching Postgres `extract(dow)` and JS `getDay()`. */
  dayOfWeek: number;
  periodName: string;
  /** "HH:MM:SS" in America/New_York. */
  startTime: string;
  endTime: string;
  graceMinutes: number;
};

/** The result of placing a scan into a meal. */
export type DerivedMeal = {
  /** New York calendar date, "YYYY-MM-DD". */
  mealDate: string;
  mealPeriod: string;
};

export const CLUB_TIMEZONE = "America/New_York";
