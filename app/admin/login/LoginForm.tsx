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
      <h1 className="text-3xl font-semibold">Cap &amp; Gown</h1>
      <p className="text-slate-600">Sign in to the meal dashboard.</p>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-slate-600">Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-slate-300 px-4 py-3 text-lg"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-slate-600">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-slate-300 px-4 py-3 text-lg"
        />
      </label>

      {failed && (
        // One message for every failure. Never "no such user" — that turns
        // this page into a way of finding out who is on the board.
        <p role="alert" className="text-red-700">
          Those details are not right.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-slate-900 px-6 py-3 text-lg text-white disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
