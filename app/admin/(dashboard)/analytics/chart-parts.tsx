"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A column whose data-end is rounded and whose baseline end is square.
 *
 * `roundTop` is false for every segment of a stack except the topmost — only
 * the end of the data gets the radius, never a join inside it.
 */
export function columnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  roundTop: boolean,
  radius = 4,
): string {
  if (height <= 0) return "";
  if (!roundTop) return `M${x},${y}h${width}v${height}h${-width}Z`;

  const r = Math.min(radius, height, width / 2);
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    "Z",
  ].join(" ");
}

/** Identity never rests on colour alone: a swatch beside text in an ink token. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-sm" style={{ color: "var(--text-secondary)" }}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** `left` is a CSS length — the SVG has a viewBox, so positions are percentages. */
export function Tooltip({ left, top, children }: { left: string; top: string; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-sm shadow-lg"
      style={{
        left,
        top,
        transform: "translate(-50%, -110%)",
        background: "var(--surface-1)",
        color: "var(--text-primary)",
        border: "1px solid var(--viz-border)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Every chart ships a table view.
 *
 * Three of the palette's light-mode hues sit below 3:1 on the light surface,
 * and some readers cannot use a chart at all. The table is the guarantee that
 * no number is reachable only through colour.
 */
export function TableView({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className="text-sm underline"
        style={{ color: "var(--text-secondary)" }}
      >
        {open ? "Hide table" : "Show table"}
      </button>

      {open && (
        <table id={id} className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead style={{ color: "var(--text-muted)" }}>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="py-1 pr-4 font-normal">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
            {rows.map((row, index) => (
              <tr key={index} style={{ borderTop: "1px solid var(--gridline)" }}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-1 pr-4">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      data-testid="chart-empty"
      className="py-12 text-center"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </p>
  );
}
