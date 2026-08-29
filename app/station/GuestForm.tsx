"use client";

import { useState } from "react";
import { isValidNetid } from "@/lib/directory/netid";

type GuestFormProps = {
  clubs: string[];
  /** Pre-filled when they got here by typing a netID we did not recognise. */
  initialNetid?: string;
  /** From the card's printed name, or the directory. Editable either way. */
  initialName?: string;
  onSubmit: (netid: string, homeClub: string, fullName: string) => void;
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

/**
 * Identify whoever is standing there.
 *
 * NOT titled "Guest", and that matters. Its netID box resolves all three
 * kinds of person: a member is checked in as a member and their card bound, a
 * returning guest is recognised, a new netID becomes a guest. It is reached
 * by tapping past the tiles AND automatically when a card matches nobody —
 * and that second path carries members, namely anyone whose card is printed
 * with a name their roster entry does not hold. Five of 196, measured. A
 * screen headed "Guest" would be telling those five something untrue at the
 * one moment they most need to understand what to do.
 */
export function GuestForm({
  clubs,
  initialNetid = "",
  initialName = "",
  onSubmit,
  onCancel,
}: GuestFormProps) {
  const [netid, setNetid] = useState(initialNetid);
  const [fullName, setFullName] = useState(initialName);
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
        if (valid) onSubmit(netid.trim().toLowerCase(), club, fullName.trim());
      }}
    >
      <h2 className="text-center text-2xl font-semibold">Type your netID</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">Name</span>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-label="Name"
          className="rounded-lg bg-surface px-4 py-3 text-xl text-ink ring-1 ring-line-strong"
        />
      </label>

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

      {/* This used to live on the screen before this one, which no longer
          appears when nobody matches. It is the only thing telling a member
          who arrived here by accident that there is a way out. */}
      <p className="text-center text-sm text-ink-muted">
        If you are a member and this is not working, please ask an officer or
        the business manager.
      </p>
    </form>
  );
}
