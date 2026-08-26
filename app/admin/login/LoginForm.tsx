"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);

        const { error } = await browserClient().auth.signInWithPassword({ email, password });

        if (error) {
          setBusy(false);
          setFailed(true);
          return;
        }

        // The allowlist check happens server-side. Someone with a valid
        // account who is not an officer lands straight back here.
        router.replace("/admin");
        router.refresh();
      }}
    >
      <h1 className="font-display text-4xl">The Cap and Gown Club</h1>
      <p className="text-ink-secondary">Sign in to the meal dashboard.</p>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg bg-surface px-4 py-3 text-lg ring-1 ring-line-strong"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink-secondary">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg bg-surface px-4 py-3 text-lg ring-1 ring-line-strong"
        />
      </label>

      {failed && (
        // One message for every failure. Never "no such user" — that turns
        // this page into a way of finding out who is on the board.
        <p role="alert" className="text-danger">
          Those details are not right.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-oxblood px-6 py-3 text-lg text-white transition-colors duration-150 hover:bg-oxblood-bright disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
