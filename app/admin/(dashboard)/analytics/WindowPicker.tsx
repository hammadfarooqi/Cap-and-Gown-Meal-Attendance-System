"use client";

import type { WindowId } from "@/lib/analytics/window";

const RELATIVE: { id: WindowId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "three", label: "Last 3 days" },
  { id: "seven", label: "Last 7 days" },
  { id: "thirty", label: "Last 30 days" },
];

const SPANS: { id: WindowId; label: string }[] = [
  { id: "semester", label: "All semester" },
  { id: "weekdays", label: "Every weekday" },
  { id: "weekends", label: "Every weekend" },
];

const DAYS: { id: WindowId; label: string }[] = [
  { id: "sun", label: "Sun" },
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
];

/**
 * Three groups, because they answer three different questions: how are we
 * doing lately, what does the whole term look like, and what does a Tuesday
 * look like. Flattening them into one row of thirteen buttons would hide
 * that.
 *
 * The relative group simply is not rendered for a past semester — see
 * availableWindows.
 */
export function WindowPicker({
  available,
  selected,
  onSelect,
}: {
  available: WindowId[];
  selected: WindowId;
  onSelect: (id: WindowId) => void;
}) {
  const group = (items: { id: WindowId; label: string }[], label: string) => {
    const shown = items.filter((item) => available.includes(item.id));
    if (shown.length === 0) return null;

    return (
      <div
        role="group"
        aria-label={label}
        className="flex overflow-hidden rounded-lg ring-1 ring-line-strong"
      >
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item.id)}
            className={`px-3 py-2 text-sm transition-colors duration-150 ${
              selected === item.id
                ? "bg-oxblood text-white"
                : "bg-surface text-ink-secondary hover:bg-oxblood-wash"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {group(RELATIVE, "Recent windows")}
      {group(SPANS, "Whole term")}
      {group(DAYS, "By day of the week")}
    </div>
  );
}
