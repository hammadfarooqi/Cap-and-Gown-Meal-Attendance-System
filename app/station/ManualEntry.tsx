"use client";

import { useState } from "react";

/**
 * Type an ID by hand.
 *
 * Always available, not a separate station. The card reader and this box end
 * at the same place — resolveScan — so a typed ID behaves exactly like a
 * scanned one, and the swipe records which way it arrived.
 *
 * The burst detector does not interfere. It watches the whole document, but
 * human typing trips its inter-key gap, so the Enter that submits this form
 * fails the burst test and flows through normally. Six characters inside
 * 200ms is about 360 words per minute; nobody types a scan by accident.
 */
export function ManualEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setValue("");
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type an ID"
        aria-label="Enter an ID by hand"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="rounded-lg bg-surface px-4 py-2 text-lg text-ink ring-1 ring-line-strong placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-lg px-4 py-2 ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash disabled:opacity-40"
      >
        Enter
      </button>
    </form>
  );
}
