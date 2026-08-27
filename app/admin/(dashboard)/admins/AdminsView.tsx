"use client";

import { useCallback, useEffect, useState } from "react";
import type { Admin } from "@/lib/auth/admin";

export function AdminsView({ me }: { me: string }) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/admins");
    if (res.ok) setAdmins((await res.json()).admins);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const field = "rounded-lg bg-page px-3 py-2 text-sm ring-1 ring-line-strong";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Officers</h1>
        <p className="max-w-2xl text-ink-secondary">
          Anyone here can sign in and change anything. Add the officers who
          need it, and remove them when they graduate.{" "}
          <strong>No email is ever sent</strong> — if somebody forgets their
          password, another officer resets it here.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-6 ring-1 ring-line">
        <h2 className="text-lg font-semibold">Add an officer</h2>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setNote(null);

            const res = await fetch("/api/admin/admins", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, password }),
            });

            if (res.ok) {
              setNote(`${email} can now sign in. Tell them their password.`);
              setEmail("");
              setPassword("");
              await load();
            } else {
              setError((await res.json()).error ?? "Could not create that account.");
            }
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-ink-secondary">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Officer email"
              className={`${field} w-64`}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-ink-secondary">
            Password they will use
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Officer password"
              className={`${field} w-64`}
            />
          </label>

          <button
            type="submit"
            disabled={!email.trim() || password.length < 12}
            className="rounded-lg bg-oxblood px-4 py-2 text-sm text-white transition-colors duration-150 hover:bg-oxblood-bright disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {error && (
          <p role="alert" data-testid="admin-error" className="text-danger">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="text-good">
            {note}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{admins.length} with access</h2>

        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th scope="col" className="py-2 font-normal">Email</th>
              <th scope="col" className="py-2 font-normal">Added</th>
              <th scope="col" className="py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.userId} className="border-t border-line">
                <td className="py-2">
                  {admin.email}
                  {admin.email === me && (
                    <span className="ml-2 text-xs text-ink-muted">you</span>
                  )}
                </td>
                <td className="py-2 text-ink-secondary">
                  {new Date(admin.addedAt).toLocaleDateString("en-US", {
                    timeZone: "America/New_York",
                    year: "numeric", month: "short", day: "numeric",
                  })}
                </td>
                <td className="flex justify-end gap-3 py-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const next = window.prompt(
                        `New password for ${admin.email} (at least 12 characters):`,
                      );
                      if (!next) return;

                      const res = await fetch(`/api/admin/admins/${admin.userId}`, {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ password: next }),
                      });
                      setError(res.ok ? null : (await res.json()).error);
                      setNote(res.ok ? `Password changed for ${admin.email}.` : null);
                    }}
                    className="text-ink-muted underline"
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${admin.email}'s access?`)) return;

                      const res = await fetch(`/api/admin/admins/${admin.userId}`, {
                        method: "DELETE",
                      });
                      if (res.ok) {
                        setError(null);
                        await load();
                      } else {
                        setError((await res.json()).error);
                      }
                    }}
                    className="text-ink-muted underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
