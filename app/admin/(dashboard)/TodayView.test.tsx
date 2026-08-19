import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayView } from "./TodayView";

function respondWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("TodayView", () => {
  it("leads with the count for the meal happening now", async () => {
    respondWith({
      currentMeal: "lunch",
      counts: [{ mealPeriod: "lunch", total: 137, members: 120, guests: 17 }],
      servedToday: 137,
    });

    render(<TodayView />);

    expect(await screen.findByTestId("hero-count")).toHaveTextContent("137");
    expect(screen.getByTestId("current-meal")).toHaveTextContent("lunch");
    expect(screen.getByText(/120 members/)).toBeInTheDocument();
  });

  it("EXPLAINS ITSELF BETWEEN MEALS instead of showing a bare zero", async () => {
    // This screen stays open all day. An unexplained 0 reads as a broken
    // system, not as "the club is not serving right now".
    respondWith({
      currentMeal: null,
      counts: [{ mealPeriod: "breakfast", total: 61, members: 55, guests: 6 }],
      servedToday: 61,
    });

    render(<TodayView />);

    expect(await screen.findByTestId("no-meal")).toBeInTheDocument();
    expect(screen.getByText(/61 people have eaten today/)).toBeInTheDocument();
    expect(screen.queryByTestId("hero-count")).not.toBeInTheDocument();
  });

  it("says nobody has eaten yet rather than reporting zero people", async () => {
    respondWith({ currentMeal: null, counts: [], servedToday: 0 });

    render(<TodayView />);

    expect(await screen.findByText(/nobody has eaten yet today/i)).toBeInTheDocument();
  });

  it("lists every meal served so far today", async () => {
    respondWith({
      currentMeal: "lunch",
      counts: [
        { mealPeriod: "breakfast", total: 61, members: 55, guests: 6 },
        { mealPeriod: "lunch", total: 137, members: 120, guests: 17 },
      ],
      servedToday: 198,
    });

    render(<TodayView />);

    expect(await screen.findByText("breakfast")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("shows one hero figure and no more", async () => {
    respondWith({
      currentMeal: "lunch",
      counts: [
        { mealPeriod: "breakfast", total: 61, members: 55, guests: 6 },
        { mealPeriod: "lunch", total: 137, members: 120, guests: 17 },
      ],
      servedToday: 198,
    });

    render(<TodayView />);
    await screen.findByTestId("hero-count");

    expect(screen.getAllByTestId("hero-count")).toHaveLength(1);
  });
});
