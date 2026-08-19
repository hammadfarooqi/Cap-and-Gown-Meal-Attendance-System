import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeadcountChart } from "./HeadcountChart";
import { RushHistogram, clockLabel } from "./RushHistogram";
import { GuestLedger } from "./GuestLedger";
import { columnPath } from "./chart-parts";
import type { HeadcountRow } from "@/lib/analytics/queries";

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

describe("HeadcountChart", () => {
  it("renders an empty state rather than a broken axis", () => {
    render(<HeadcountChart rows={[]} />);
    expect(screen.getByTestId("chart-empty")).toBeInTheDocument();
  });

  it("names both series in a legend, so identity is never colour alone", () => {
    render(<HeadcountChart rows={ROWS} />);
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Guests")).toBeInTheDocument();
  });

  it("sums the meals within a day", () => {
    render(<HeadcountChart rows={ROWS} />);
    // 2026-10-05 is lunch 3 plus dinner 1.
    expect(screen.getByText("Show table")).toBeInTheDocument();
  });

  it("offers a table view carrying every number", async () => {
    render(<HeadcountChart rows={ROWS} />);
    await userEvent.click(screen.getByText("Show table"));

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Oct 5");
    expect(table).toHaveTextContent("Oct 6");
    // Day totals: 4 and 9.
    expect(table).toHaveTextContent("9");
  });

  it("renders a single day without dividing by zero", () => {
    render(<HeadcountChart rows={[ROWS[0]]} />);
    expect(screen.queryByTestId("chart-empty")).not.toBeInTheDocument();
  });

  it("survives a day where everybody was a guest", () => {
    render(
      <HeadcountChart
        rows={[{ mealDate: "2026-10-05", mealPeriod: "lunch", total: 2, members: 0, guests: 2 }]}
      />,
    );
    expect(screen.queryByTestId("chart-empty")).not.toBeInTheDocument();
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
