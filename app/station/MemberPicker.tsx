"use client";

import { useMemo, useState } from "react";
import type { CachedPerson } from "@/lib/station/store";

type MemberPickerProps = {
  /** Every member, so an already-bound one can still be found. */
  all: CachedPerson[];
  /** Members with no card yet — shown first, since that is the common case. */
  unbound: CachedPerson[];
  /**
   * The name the card's magnetic stripe carried, split into parts.
   *
   * A TigerCard says who the holder is. On the first day, when 196 people
   * each need binding once, that turns "search a list of 196 during a rush"
   * into "confirm the one name already on screen". Which part is the surname
   * varies by issuer, so both are tried.
   */
  nameHint?: string[];
  onPick: (netid: string) => void;
  onCancel: () => void;
};

/** How many of the hint's parts a member's name matches. */
function hintScore(person: CachedPerson, hint: string[]): number {
  const name = person.fullName.toLowerCase();
  return hint.filter((part) => part.length > 1 && name.includes(part.toLowerCase())).length;
}

export function MemberPicker({
  all,
  unbound,
  nameHint = [],
  onPick,
  onCancel,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");

  /** Members whose name matches what the card said. Usually exactly one. */
  const suggested = useMemo(() => {
    if (nameHint.length === 0) return [];
    return all
      .map((person) => ({ person, score: hintScore(person, nameHint) }))
      .filter((entry) => entry.score === nameHint.filter((p) => p.length > 1).length)
      .map((entry) => entry.person)
      .slice(0, 5);
  }, [all, nameHint]);

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

      {suggested.length > 0 && query.trim() === "" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            The card says {nameHint.join(" ")}
          </p>
          <ul className="flex flex-col gap-2">
            {suggested.map((person) => (
              <li key={person.netid}>
                <button
                  type="button"
                  data-testid="suggested-member"
                  onClick={() => onPick(person.netid)}
                  className="w-full rounded-lg bg-oxblood-bright px-4 py-3 text-left text-lg text-white transition-colors duration-150 hover:bg-oxblood"
                >
                  {person.fullName}
                  <span className="ml-2 text-sm text-white/70">{person.netid}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
