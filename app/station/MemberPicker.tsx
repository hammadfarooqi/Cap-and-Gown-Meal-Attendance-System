"use client";

import { useMemo, useState } from "react";
import type { CachedPerson } from "@/lib/station/store";

type MemberPickerProps = {
  /** Every member, so an already-bound one can still be found. */
  all: CachedPerson[];
  /** Members with no card yet — shown first, since that is the common case. */
  unbound: CachedPerson[];
  onPick: (netid: string) => void;
  onCancel: () => void;
};

export function MemberPicker({ all, unbound, onPick, onCancel }: MemberPickerProps) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();

    // With no search, offer the people most likely to be standing there.
    if (!term) return unbound;

    // With a search, look across everyone. A member who already has a card
    // and turns up with a replacement is otherwise unreachable, and would be
    // forced through the guest flow.
    return all.filter(
      (p) =>
        p.fullName.toLowerCase().includes(term) ||
        p.netid.toLowerCase().includes(term),
    );
  }, [query, all, unbound]);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <h2 className="text-2xl font-semibold">Who is this?</h2>

      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or netID"
        aria-label="Search members"
        className="rounded-lg bg-surface px-4 py-3 text-xl text-ink ring-1 ring-line-strong placeholder:text-ink-muted"
      />

      <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line">
        {shown.map((person) => (
          <li key={person.netid}>
            <button
              type="button"
              onClick={() => onPick(person.netid)}
              className="w-full px-4 py-3 text-left text-lg transition-colors duration-150 hover:bg-oxblood-wash"
            >
              {person.fullName}
              <span className="ml-2 text-sm text-ink-muted">{person.netid}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-3 text-ink-muted">No members match that search.</li>
        )}
      </ul>

      <button
        type="button"
        onClick={onCancel}
        className="self-start text-ink-muted underline"
      >
        Cancel
      </button>
    </div>
  );
}
