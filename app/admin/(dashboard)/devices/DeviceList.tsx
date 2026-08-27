"use client";

import { useEffect, useState } from "react";
import type { DeviceRow } from "@/app/api/admin/devices/route";

function lastSeen(value: string | null): string {
  if (!value) return "never";

  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 90) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function DeviceList() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/admin/devices");
    if (res.ok) setDevices((await res.json()).devices);
  };

  useEffect(() => {
    void load();
  }, []);

  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);
  const shown = showRevoked ? [...active, ...revoked] : active;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Set up a tablet</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lane 1"
            aria-label="Tablet name"
            className="rounded-lg bg-surface px-3 py-2 ring-1 ring-line-strong"
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={async () => {
              const res = await fetch("/api/admin/devices", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name }),
              });
              if (res.ok) {
                setCode((await res.json()).code);
                setName("");
                await load();
              }
            }}
            className="rounded-lg bg-oxblood px-4 py-2 text-white transition-colors duration-150 hover:bg-oxblood-bright disabled:opacity-40"
          >
            Get a code
          </button>
        </div>

        {code && (
          <div className="rounded-xl bg-oxblood-wash p-5 ring-1 ring-line">
            <p className="text-sm text-ink-secondary">
              Open the scanner on the tablet and enter this. It expires in 15 minutes.
            </p>
            {/* Large enough to read across a room, because that is where the
                tablet is while somebody reads it off this screen. */}
            <p data-testid="enrollment-code" className="mt-2 font-mono text-5xl tracking-[0.3em]">
              {code}
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {/* Revoked tablets are hidden by default. Over four years the club
            will retire a good many, and a list that only grows makes the two
            that matter today harder to find. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {active.length} in use
          </h2>
          {revoked.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRevoked(!showRevoked)}
              className="text-sm text-ink-secondary underline"
            >
              {showRevoked ? "Hide" : "Show"} {revoked.length} revoked
            </button>
          )}
        </div>

        {error && (
          <p role="alert" data-testid="device-error" className="text-danger">
            {error}
          </p>
        )}
        <table className="w-full text-left">
          <thead className="text-sm text-ink-muted">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Last seen</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((device) => (
              <tr key={device.id} className="border-t border-line">
                <td className="py-3">
                  <span>{device.name}</span>
                  {device.revokedAt && (
                    <span className="ml-2 rounded bg-oxblood-wash px-2 py-0.5 text-xs text-ink-secondary">
                      revoked
                    </span>
                  )}
                </td>
                <td className="py-3 text-ink-secondary">{lastSeen(device.lastSeenAt)}</td>
                <td className="py-3 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      const permanent = Boolean(device.revokedAt);

                      if (permanent && !window.confirm(`Remove "${device.name}" from this list?`)) {
                        return;
                      }

                      const res = await fetch(
                        `/api/admin/devices/${device.id}${permanent ? "?permanent=true" : ""}`,
                        { method: "DELETE" },
                      );
                      if (!res.ok) setError((await res.json()).error);
                      await load();
                    }}
                    className="rounded-lg px-3 py-1 text-sm ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash"
                  >
                    {device.revokedAt ? "Remove" : "Revoke"}
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-ink-muted">
                  {devices.length === 0
                    ? "No tablets set up yet."
                    : "No tablets in use. Set one up above."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
