"use client";

import { useCallback, useEffect, useState } from "react";
import type { MealCount } from "@/lib/analytics/queries";
import "./analytics/viz.css";

const POLL_MS = 20_000;

type Payload = { currentMeal: string | null; counts: MealCount[]; servedToday: number };

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="viz-root rounded-xl px-5 py-4"
      style={{ border: "1px solid var(--viz-border)" }}
    >
      <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
}

export function TodayView() {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/today", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
    // A number twenty seconds stale is fine, and a poll is one line that a
    // future club member can read. Realtime subscriptions are more moving
    // parts than this earns.
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) return <p className="text-slate-500">Loading…</p>;

  const current = data.counts.find((c) => c.mealPeriod === data.currentMeal);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Today</h1>

      {data.currentMeal ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-widest text-slate-500" data-testid="current-meal">
            {data.currentMeal} — happening now
          </p>
          {/* The hero figure. Exactly one per view. */}
          <p data-testid="hero-count" className="text-7xl font-semibold leading-none">
            {current?.total ?? 0}
          </p>
          <p className="text-slate-600">
            {current?.members ?? 0} members · {current?.guests ?? 0} guests
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          {/* An unexplained 0 on a screen that stays open all day reads as a
              broken system rather than as "between meals". */}
          <p data-testid="no-meal" className="text-2xl">
            No meal is running right now.
          </p>
          <p className="text-slate-600">
            {data.servedToday === 0
              ? "Nobody has eaten yet today."
              : `${data.servedToday} people have eaten today.`}
          </p>
        </section>
      )}

      {data.counts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Every meal today</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.counts.map((count) => (
              <StatTile
                key={count.mealPeriod}
                label={count.mealPeriod}
                value={count.total}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
