"use client";

import { useState } from "react";
import { presetRange, type DateRange } from "@/lib/analytics/range";

/**
 * Export is the one place an arbitrary range genuinely matters — "Fall
 * Semester 2026" is not a preset — so it gets real date fields rather than
 * the fixed windows the charts use.
 */
export function ExportView() {
  const [range, setRange] = useState<DateRange>(() => presetRange("semester"));

  const field = "rounded-lg bg-surface px-3 py-2 ring-1 ring-line-strong";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Export</h1>
        <p className="max-w-2xl text-ink-secondary">
          One row per person per meal, as a spreadsheet. If you want a number no
          chart here shows, this is how you get it — open the file and count.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-ink-secondary">
          From
          <input
            type="date"
            value={range.from}
            aria-label="From date"
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm text-ink-secondary">
          To
          <input
            type="date"
            value={range.to}
            aria-label="To date"
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className={field}
          />
        </label>

        {/* A plain link, so the browser handles the download itself. */}
        <a
          href={`/api/admin/export?from=${range.from}&to=${range.to}`}
          download
          className="rounded-lg bg-oxblood px-6 py-2.5 text-white transition-colors duration-150 hover:bg-oxblood-bright"
        >
          Download spreadsheet
        </a>
      </div>
    </div>
  );
}
