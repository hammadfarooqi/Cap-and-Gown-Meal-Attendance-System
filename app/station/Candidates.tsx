"use client";

import type { CachedPerson } from "@/lib/station/store";
import { Avatar } from "./Avatar";

type CandidatesProps = {
  /** Unbound people the card's printed name could mean. May be empty. */
  people: CachedPerson[];
  onPick: (netid: string) => void;
  onGuest: () => void;
  onCancel: () => void;
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
export function Candidates({ people, onPick, onGuest, onCancel }: CandidatesProps) {
  return (
    <div className="flex flex-col items-center gap-8">
      {/* Three headings, not two. With no tiles, "Is this you?" is a question
          about nobody — it rendered above an empty space and told the person
          swiping nothing at all. */}
      <p data-testid="candidates" className="text-3xl">
        {people.length === 0
          ? "You haven\u2019t scanned here before"
          : people.length > 1
            ? "Which one is you?"
            : "Is this you?"}
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
              {/* Load-bearing, not decoration, and sized to say so. Rendered
                  side by side, two members who share a full name produce two
                  tiles reading the same initials and the same name; the netID
                  is the only difference between them. It was the smallest,
                  dimmest text on the tile until somebody looked at it. */}
              <span className="text-2xl tracking-wide text-ink">{person.netid}</span>
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
          {people.length === 0 ? "I\u2019m a guest" : "No, I\u2019m a guest"}
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
