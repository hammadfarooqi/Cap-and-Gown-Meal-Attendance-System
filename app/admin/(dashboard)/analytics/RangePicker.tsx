"use client";

import type { DateRange, RangePreset } from "@/lib/analytics/range";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "semester", label: "This semester" },
];

/**
 * Presets first. A business manager checking Tuesday's lunch should not have
 * to operate a date picker; the custom range is there for the one time a year
 * somebody wants an odd window.
 */
export function RangePicker({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: RangePreset | "custom";
  range: DateRange;
  onPreset: (preset: RangePreset) => void;
  onCustom: (range: DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preset === option.value}
          onClick={() => onPreset(option.value)}
          className={`rounded-lg px-3 py-2 text-sm ${
            preset === option.value
              ? "bg-slate-900 text-white"
              : "border border-slate-300 text-slate-600"
          }`}
        >
          {option.label}
        </button>
      ))}

      <span className="mx-2 text-slate-300">|</span>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        From
        <input
          type="date"
          value={range.from}
          aria-label="From date"
          onChange={(e) => onCustom({ ...range, from: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        To
        <input
          type="date"
          value={range.to}
          aria-label="To date"
          onChange={(e) => onCustom({ ...range, to: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1"
        />
      </label>
    </div>
  );
}
