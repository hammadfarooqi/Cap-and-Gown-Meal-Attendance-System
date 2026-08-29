"use client";

import { useState } from "react";
import { isValidNetid } from "@/lib/directory/lookup";

/**
 * Type a netID by hand.
 *
 * Always available, not a separate station. The card reader and this box end
 * at the same place — resolveScan — so a typed netID behaves exactly like a
 * scanned card, and the swipe records which way it arrived.
 *
 * The burst detector does not interfere. It watches the whole document, but
 * human typing trips its inter-key gap, so the Enter that submits this form
 * fails the burst test and flows through normally. Six characters inside
 * 200ms is about 360 words per minute; nobody types a scan by accident.
 */
export function ManualEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  // Anything typed here is a netID. Letting a malformed one through does not
  // fail visibly — it finds nobody, offers the guest route, and invites
  // somebody to be created under an id that cannot be theirs.
  const valid = isValidNetid(value);

  return (
    <form
      className="flex flex-col items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        onSubmit(value.trim().toLowerCase());
        setValue("");
        setTouched(false);
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type a netID"
          aria-label="Type a netID"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded-lg bg-surface px-4 py-2 text-lg text-ink ring-1 ring-line-strong placeholder:text-ink-muted"
        />
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg px-4 py-2 ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash disabled:opacity-40"
        >
          Enter
        </button>
      </div>

      {touched && !valid && (
        <p role="alert" className="text-sm text-danger">
          A netID is two letters and four digits.
        </p>
      )}
    </form>
  );
}
