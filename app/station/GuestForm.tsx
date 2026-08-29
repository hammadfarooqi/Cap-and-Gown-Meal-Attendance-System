"use client";

import { useState } from "react";
import { isValidNetid } from "@/lib/directory/lookup";

type GuestFormProps = {
  clubs: string[];
  /** Pre-filled when they got here by typing a netID we did not recognise. */
  initialNetid?: string;
  onSubmit: (netid: string, homeClub: string) => void;
  onCancel: () => void;
};

/** The club this system belongs to. A guest of it is by definition not in it. */
const HOME_CLUB = "Cap & Gown";

/**
 * The clubs a guest can be from: everyone else, then "Not in a club" last.
 *
 * Cap & Gown is removed rather than merely discouraged. Somebody standing
 * here is either a member — in which case they came the wrong way and their
 * netID resolves them properly — or they are not, and the option is a lie.
 */
function guestClubs(clubs: string[]): string[] {
  const others = clubs.filter((c) => c !== "None" && c !== HOME_CLUB);
  return [...others, ...clubs.filter((c) => c === "None")];
}

export function GuestForm({ clubs, initialNetid = "", onSubmit, onCancel }: GuestFormProps) {
  const [netid, setNetid] = useState(initialNetid);
  // Starts unchosen. Defaulting to the first club alphabetically meant a
  // careless submit filed a guest as a member of whichever club that was.
  const [club, setClub] = useState("");
  const [touched, setTouched] = useState(false);

  const netidOk = isValidNetid(netid);
  const clubOk = club !== "";
  const valid = netidOk && clubOk;

  return (
    <form
      className="flex w-full max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        // Checked here as well as on the server so an obvious typo never
        // costs a round trip while someone waits at the tablet.
        if (valid) onSubmit(netid.trim().toLowerCase(), club);
      }}
    >
      <h2 className="text-center text-2xl font-semibold">Guest</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">netID</span>
        <input
          autoFocus
          type="text"
          value={netid}
          onChange={(e) => setNetid(e.target.value)}
          onBlur={() => setTouched(true)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Guest netID"
          className="rounded-lg bg-surface px-4 py-3 text-xl text-ink ring-1 ring-line-strong"
        />
      </label>

      {touched && !netidOk && (
        <p role="alert" className="text-sm text-danger">
          That does not look like a netID.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">Your club</span>
        <select
          value={club}
          onChange={(e) => setClub(e.target.value)}
          aria-label="Your club"
          className="rounded-lg bg-surface px-4 py-3 text-xl text-ink ring-1 ring-line-strong"
        >
          <option value="" disabled>
            Choose one…
          </option>
          {/* "Not in a club" is an answer of last resort, so it sits at the
              bottom rather than wherever "None" falls alphabetically. */}
          {guestClubs(clubs).map((name) => (
            <option key={name} value={name}>
              {name === "None" ? "Not in a club" : name}
            </option>
          ))}
        </select>
      </label>

      {touched && netidOk && !clubOk && (
        <p role="alert" className="text-sm text-danger">
          Please choose a club.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg bg-oxblood-bright px-6 py-3 text-lg text-white transition-colors duration-150 hover:bg-oxblood disabled:opacity-40"
        >
          Check in
        </button>
        <button type="button" onClick={onCancel} className="px-4 text-ink-muted underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
