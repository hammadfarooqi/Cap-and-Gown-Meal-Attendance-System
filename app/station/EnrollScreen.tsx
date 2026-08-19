"use client";

import { useState } from "react";
import { enrollDevice } from "@/lib/station/session";

/**
 * What a stranger sees if they find this URL. Without a valid code the API
 * refuses everything, so this screen is a dead end rather than a way in.
 */
export function EnrollScreen({ onEnrolled }: { onEnrolled: () => void }) {
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        const ok = await enrollDevice(code);
        setBusy(false);
        if (ok) onEnrolled();
        else setFailed(true);
      }}
    >
      <h1 className="text-3xl font-semibold">Set up this tablet</h1>
      <p className="text-slate-600">
        Enter the enrolment code from the admin dashboard.
      </p>

      <input
        autoFocus
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Enrolment code"
        className="rounded-lg border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.3em]"
      />

      {failed && (
        <p role="alert" className="text-red-700">
          That code is not valid, or it has expired.
        </p>
      )}

      <button
        type="submit"
        disabled={busy || code.trim().length === 0}
        className="rounded-lg bg-slate-900 px-6 py-3 text-lg text-white disabled:opacity-40"
      >
        {busy ? "Checking…" : "Set up"}
      </button>
    </form>
  );
}
