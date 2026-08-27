"use client";

import { useEffect } from "react";
import type { CachedPerson } from "@/lib/station/store";
import { Avatar } from "./Avatar";

/**
 * How long this stays up before the lane is released.
 *
 * Result screens fall back to idle after 3 seconds. This one must not —
 * somebody is standing here reading it and deciding. 30 seconds is long
 * enough to choose and short enough that a swipe walked away from does not
 * block the tablet for the next person.
 */
export const CANDIDATES_DISMISS_MS = 30_000;

type CandidatesProps = {
  /** Unbound people the card's printed name could mean. May be empty. */
  people: CachedPerson[];
  onPick: (netid: string) => void;
  onGuest: () => void;
  onCancel: () => void;
  /** Injectable so a test need not wait 30 seconds or fake timers. */
  dismissMs?: number;
};

/**
 * "Is this you?" — the first swipe of an unbound card.
 *
 * Zero, one and many candidates are all this screen; only the number of tiles
 * changes. That is what replaces the old "Card not recognised" prompt, its
 * member-or-guest fork, and the search over 196 names.
 *
 * A name never identifies anybody (spec A8), so nothing here binds without a
 * person tapping their own tile.
 */
export function Candidates({
  people,
  onPick,
  onGuest,
  onCancel,
  dismissMs = CANDIDATES_DISMISS_MS,
}: CandidatesProps) {
  // onCancel comes from a useCallback in StationScreen, so it is stable. If it
  // ever stops being, this effect would clear its own timer on every render —
  // the failure that has bitten this codebase twice already.
  useEffect(() => {
    const timer = setTimeout(onCancel, dismissMs);
    return () => clearTimeout(timer);
  }, [onCancel, dismissMs]);

  return (
    <div className="flex flex-col items-center gap-8">
      <p data-testid="candidates" className="text-3xl">
        {people.length > 1 ? "Which one is you?" : "Is this you?"}
      </p>

      {people.length > 0 && (
        <div className="flex flex-wrap justify-center gap-6">
          {people.map((person) => (
            <button
              key={person.netid}
              type="button"
              onClick={() => onPick(person.netid)}
              className="flex flex-col items-center gap-3 rounded-2xl px-8 py-6 ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash"
            >
              <Avatar name={person.fullName} url={null} size="tile" />
              <span className="font-display text-3xl">{person.fullName}</span>
              {/* Load-bearing, not decoration. No headshots are loaded, and
                  two members share a full name — so they share their initials
                  too. The netID is the only thing here that separates them,
                  and each of them knows their own. */}
              <span className="text-lg text-ink-secondary">{person.netid}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button
          type="button"
          onClick={onGuest}
          className="rounded-xl px-8 py-4 text-xl ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash"
        >
          No, I&apos;m a guest
        </button>
        <button type="button" onClick={onCancel} className="px-4 text-ink-muted underline">
          Cancel
        </button>
      </div>

      <p className="max-w-md text-center text-sm text-ink-muted">
        If you are a member and you do not see yourself, please ask an officer
        or the business manager.
      </p>
    </div>
  );
}
