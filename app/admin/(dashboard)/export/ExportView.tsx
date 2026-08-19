"use client";

import { useState } from "react";
import { presetRange, type DateRange, type RangePreset } from "@/lib/analytics/range";
import { RangePicker } from "../analytics/RangePicker";

export function ExportView() {
  const [preset, setPreset] = useState<RangePreset | "custom">("semester");
  const [range, setRange] = useState<DateRange>(() => presetRange("semester"));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Export</h1>
        <p className="max-w-2xl text-slate-600">
          One row per person per meal, as a spreadsheet. If you want a number no
          chart on this dashboard shows, this is how you get it — open the file
          in Excel and count.
        </p>
      </div>

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

      {/* A plain link, so the browser handles the download itself. */}
      <a
        href={`/api/admin/export?from=${range.from}&to=${range.to}`}
        download
        className="self-start rounded-lg bg-slate-900 px-6 py-3 text-white"
      >
        Download {range.from} to {range.to}
      </a>
    </div>
  );
}
