"use client";

import { useCallback, useEffect, useState } from "react";
import { presetRange, type DateRange, type RangePreset } from "@/lib/analytics/range";
import type { ClubRow, HeadcountRow, HistogramBucket } from "@/lib/analytics/queries";
import { RangePicker } from "./RangePicker";
import { HeadcountChart } from "./HeadcountChart";
import { RushHistogram } from "./RushHistogram";
import { GuestLedger } from "./GuestLedger";
import "./viz.css";

type Payload = {
  headcount: HeadcountRow[];
  histogram: HistogramBucket[];
  clubs: ClubRow[];
  averages: { mealPeriod: string; average: number }[];
};

export function AnalyticsView() {
  const [preset, setPreset] = useState<RangePreset | "custom">("week");
  const [range, setRange] = useState<DateRange>(() => presetRange("week"));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (next: DateRange) => {
    setLoading(true);
    const res = await fetch(`/api/admin/analytics?from=${next.from}&to=${next.to}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <RangePicker
          preset={preset}
          range={range}
          onPreset={(value) => {
            setPreset(value);
            setRange(presetRange(value));
          }}
          onCustom={(value) => {
            setPreset("custom");
            setRange(value);
          }}
        />
      </div>

      {data && data.averages.length > 0 && (
        <p className="text-sm text-slate-600" data-testid="averages">
          Average per meal served:{" "}
          {data.averages.map((a) => `${a.mealPeriod} ${a.average}`).join(" · ")}
        </p>
      )}

      {loading && !data ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        data && (
          <>
            <HeadcountChart rows={data.headcount} />
            <RushHistogram buckets={data.histogram} />
            <GuestLedger rows={data.clubs} />
          </>
        )
      )}
    </div>
  );
}
