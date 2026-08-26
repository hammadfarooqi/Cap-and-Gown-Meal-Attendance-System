"use client";

import type { Semester } from "@/lib/analytics/semester";

/**
 * The outer scope. Everything below it is clamped to the term in view, so
 * "last 30 days" early in September cannot reach back into the spring.
 */
export function SemesterPicker({
  semesters,
  selected,
  onSelect,
}: {
  semesters: Semester[];
  selected: Semester;
  onSelect: (id: string) => void;
}) {
  // One term is not a choice. Show it as a label until there is a second.
  if (semesters.length <= 1) {
    return <span className="text-sm text-ink-secondary">{selected.label}</span>;
  }

  return (
    <label className="flex items-center gap-2 text-sm text-ink-secondary">
      Semester
      <select
        value={selected.id}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Semester"
        className="rounded-lg bg-surface px-3 py-1.5 text-ink ring-1 ring-line-strong"
      >
        {semesters.map((semester) => (
          <option key={semester.id} value={semester.id}>
            {semester.label}
          </option>
        ))}
      </select>
    </label>
  );
}
