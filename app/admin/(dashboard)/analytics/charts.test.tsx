import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekChart } from "./WeekChart";
import { AveragesPanel } from "./AveragesPanel";
import { layOutWeek } from "@/lib/analytics/week";
import { RushHistogram, clockLabel } from "./RushHistogram";
import { GuestLedger } from "./GuestLedger";
import { columnPath } from "./chart-parts";
import type { HeadcountRow } from "@/lib/analytics/queries";

// 2026-08-25 is a Tuesday; its week runs Sunday 08-23 to Saturday 08-29.
const TUESDAY = new Date("2026-08-25T16:00:00Z");

const ROWS: HeadcountRow[] = [
  { mealDate: "2026-10-05", mealPeriod: "lunch", total: 3, members: 2, guests: 1 },
  { mealDate: "2026-10-05", mealPeriod: "dinner", total: 1, members: 1, guests: 0 },
  { mealDate: "2026-10-06", mealPeriod: "lunch", total: 9, members: 7, guests: 2 },
];

describe("columnPath", () => {
  it("rounds only the data-end, leaving the baseline square", () => {
    const rounded = columnPath(0, 0, 20, 40, true);
    const square = columnPath(0, 0, 20, 40, false);

    expect(rounded).toContain("Q");
    expect(square).not.toContain("Q");
  });

  it("does not let the radius exceed a short bar's height", () => {
    // A one-pixel bar with a 4px radius would otherwise invert into a bulge.
    const path = columnPath(0, 0, 20, 1, true, 4);
    expect(path).not.toContain("NaN");
    expect(path).toContain("Q");
  });

  it("draws nothing for a zero-height bar", () => {
    expect(columnPath(0, 0, 20, 0, true)).toBe("");
  });
});

describe("clockLabel", () => {
  it.each([
    [0, "12:00am"],
    [690, "11:30am"],
    [720, "12:00pm"],
    [750, "12:30pm"],
    [1140, "7:00pm"],
  ])("renders minute %i as %s", (minute, expected) => {
    expect(clockLabel(minute)).toBe(expected);
  });
});

describe("WeekChart", () => {
  const week = (rows: HeadcountRow[]) => layOutWeek(rows, TUESDAY);

  const chart = (rows: HeadcountRow[], nav: { prev?: boolean; next?: boolean } = {}) => (
    <WeekChart
      week={week(rows)}
      title="Aug 23 – Aug 29"
      onPrevious={nav.prev === false ? null : () => {}}
      onNext={nav.next ? () => {} : null}
    />
  );

  it("ALWAYS DRAWS SEVEN DAYS, Sunday to Saturday", async () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    await userEvent.click(screen.getByText("Show table"));
    const table = screen.getByRole("table");

    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      expect(table).toHaveTextContent(day);
    }
  });

  it("gives a weekday three services and a weekend two", async () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    await userEvent.click(screen.getByText("Show table"));
    const rows = screen.getAllByRole("row");

    // 7 days: 5 weekdays x 3 + 2 weekend days x 2 = 19 services, plus a header.
    expect(rows).toHaveLength(20);
  });

  it("NAMES BRUNCH AND LUNCH TOGETHER in the legend, because they share a colour", () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    expect(screen.getByText("Lunch / brunch")).toBeInTheDocument();
  });

  it("names all three services, so identity is never colour alone", () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Dinner")).toBeInTheDocument();
  });

  it("SHOWS THE DATE WITH ITS MONTH, so a week reads without counting back", () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    expect(screen.getByText("Aug 23")).toBeInTheDocument();
    expect(screen.getByText("Aug 29")).toBeInTheDocument();
  });

  it("DISABLES THE FORWARD ARROW on the latest week, because the future has not happened", () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ]));

    expect(screen.getByLabelText("Next week")).toBeDisabled();
    expect(screen.getByLabelText("Previous week")).toBeEnabled();
  });

  it("enables the forward arrow when a later week exists", () => {
    render(chart([
      { mealDate: "2026-08-25", mealPeriod: "lunch", total: 140, members: 120, guests: 20 },
    ], { next: true }));

    expect(screen.getByLabelText("Next week")).toBeEnabled();
  });

  it("disables the back arrow at the start of term", () => {
    render(chart([], { prev: false }));
    expect(screen.getByLabelText("Previous week")).toBeDisabled();
  });

  it("says so plainly when the week has not started", () => {
    render(chart([]));
    expect(screen.getByTestId("week-empty")).toBeInTheDocument();
  });

  it("draws a week with one service without dividing by zero", () => {
    render(chart([
      { mealDate: "2026-08-23", mealPeriod: "brunch", total: 88, members: 80, guests: 8 },
    ]));

    expect(screen.queryByTestId("week-empty")).not.toBeInTheDocument();
  });
});

describe("AveragesPanel", () => {
  it("reports the average for each service", () => {
    render(<AveragesPanel averages={[{ mealPeriod: "lunch", average: 137.5 }]} daysServed={4} />);

    expect(screen.getByText("137.5")).toBeInTheDocument();
    expect(screen.getByText(/across 4 days that served meals/)).toBeInTheDocument();
  });

  it("SAYS DAYS SERVED, not days elapsed", () => {
    // Dividing by calendar days would silently deflate any window with a
    // closed day in it.
    render(<AveragesPanel averages={[{ mealPeriod: "lunch", average: 10 }]} daysServed={1} />);
    expect(screen.getByText(/across 1 day that served meals/)).toBeInTheDocument();
  });

  it("NAMES THE UNIT IT DIVIDED BY, so 'every Monday' does not read as days", () => {
    render(
      <AveragesPanel
        averages={[{ mealPeriod: "lunch", average: 121 }]}
        daysServed={12}
        unit="Monday"
      />,
    );
    expect(screen.getByText(/across 12 Mondays that served meals/)).toBeInTheDocument();
  });

  it("says so plainly when nothing was served", () => {
    render(<AveragesPanel averages={[]} daysServed={0} />);
    expect(screen.getByText(/no meals were served in this window/i)).toBeInTheDocument();
  });
});

describe("RushHistogram", () => {
  it("renders an empty state for a range with no scans", () => {
    render(<RushHistogram buckets={[]} />);
    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });

  it("names the peak in words, not only as a bar", () => {
    // The whole point of this chart is one sentence a kitchen can act on.
    render(
      <RushHistogram
        buckets={[
          { mealPeriod: "lunch", minuteOfDay: 690, total: 4 },
          { mealPeriod: "lunch", minuteOfDay: 720, total: 31 },
          { mealPeriod: "lunch", minuteOfDay: 750, total: 12 },
        ]}
      />,
    );

    // The subtitle states it, and so does the chart's accessible name — a
    // screen reader must get the same one-sentence answer as a sighted reader.
    expect(screen.getByRole("img")).toHaveAccessibleName(/Peak at 12:00pm with 31 scans/);
    expect(screen.getByText(/busiest at 12:00pm/)).toBeInTheDocument();
  });

  it("handles a single bucket without dividing by zero", () => {
    render(<RushHistogram buckets={[{ mealPeriod: "lunch", minuteOfDay: 720, total: 3 }]} />);
    expect(screen.queryByTestId("chart-empty")).not.toBeInTheDocument();
  });

  it("GIVES EACH MEAL ITS OWN PANEL rather than one long empty axis", () => {
    // Lunch and dinner are six hours apart. On a single minute-of-day axis
    // most of the chart is empty afternoon and the bars become hairlines.
    render(
      <RushHistogram
        buckets={[
          { mealPeriod: "lunch", minuteOfDay: 720, total: 30 },
          { mealPeriod: "dinner", minuteOfDay: 1105, total: 9 },
        ]}
      />,
    );

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("lunch")).toBeInTheDocument();
    expect(screen.getByText("dinner")).toBeInTheDocument();
  });
});

describe("GuestLedger", () => {
  it("says so plainly when there were no guests", () => {
    render(<GuestLedger rows={[]} />);
    expect(screen.getByText(/no guests in this range/i)).toBeInTheDocument();
  });

  it("labels 'None' as not being in a club", () => {
    render(<GuestLedger rows={[{ homeClub: "None", visits: 2, people: 1 }]} />);
    expect(screen.getByText("Not in a club")).toBeInTheDocument();
  });

  it("shows visits and people as separate columns", () => {
    render(<GuestLedger rows={[{ homeClub: "Cottage", visits: 5, people: 2 }]} />);

    const row = screen.getByRole("row", { name: /Cottage/ });
    expect(row).toHaveTextContent("5");
    expect(row).toHaveTextContent("2");
  });
});
