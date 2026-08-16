"use client";

import { useEffect, useState } from "react";
import { onScan } from "@/lib/scan/burst";

type Person = { netid: string; fullName: string; isMember: boolean };

type Status =
  | { kind: "idle" }
  | { kind: "success"; person: Person }
  | { kind: "unknown" }
  | { kind: "failed" };

/**
 * WALKING SKELETON — deliberately crude.
 *
 * No local cache, no photo cache, no outbox, no member-or-guest prompt. Every
 * scan goes straight to the server, so this cannot work offline and does not
 * meet the 500ms budget. Plan 2 replaces the internals entirely.
 *
 * What it is for: proving the whole path connects, on real hardware, in week
 * one rather than on 2026-08-29.
 */
export default function StationPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    const deviceToken = localStorage.getItem("deviceToken") ?? "";

    const authHeaders = {
      "content-type": "application/json",
      authorization: `Bearer ${deviceToken}`,
    };

    return onScan(async (token) => {
      try {
        const resolved = await fetch("/api/resolve", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ token }),
        });

        if (resolved.status === 404) {
          setStatus({ kind: "unknown" });
          return;
        }
        if (!resolved.ok) {
          setStatus({ kind: "failed" });
          return;
        }

        const person: Person = (await resolved.json()).data;

        await fetch("/api/sync", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            swipes: [
              {
                netid: person.netid,
                scannedAt: new Date().toISOString(),
                entryMethod: "scan",
              },
            ],
          }),
        });

        setStatus({ kind: "success", person });
      } catch {
        setStatus({ kind: "failed" });
      }
    });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      {status.kind === "idle" && (
        <p data-testid="idle" className="text-2xl text-gray-500">
          Scan your card
        </p>
      )}

      {status.kind === "success" && (
        <>
          <p data-testid="name" className="text-5xl font-semibold">
            {status.person.fullName}
          </p>
          <p data-testid="checked-in" className="text-2xl text-green-700">
            Checked in
          </p>
        </>
      )}

      {status.kind === "unknown" && (
        <p data-testid="unknown" className="text-3xl text-amber-700">
          Card not recognised
        </p>
      )}

      {status.kind === "failed" && (
        <p data-testid="failed" className="text-3xl text-red-700">
          Could not reach the server — not counted
        </p>
      )}
    </main>
  );
}
