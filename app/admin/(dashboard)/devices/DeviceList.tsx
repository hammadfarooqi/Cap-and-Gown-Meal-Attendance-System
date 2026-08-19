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

  const load = async () => {
    const res = await fetch("/api/admin/devices");
    if (res.ok) setDevices((await res.json()).devices);
  };

  useEffect(() => {
    void load();
  }, []);

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
            className="rounded-lg border border-slate-300 px-3 py-2"
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
            className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40"
          >
            Get a code
          </button>
        </div>

        {code && (
          <div className="rounded-lg border border-slate-300 p-4">
            <p className="text-sm text-slate-600">
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
        <h2 className="text-lg font-semibold">Tablets</h2>
        <table className="w-full text-left">
          <thead className="text-sm text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Last seen</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-t border-slate-200">
                <td className="py-3">
                  {device.name}
                  {device.revokedAt && (
                    <span className="ml-2 text-sm text-red-700">revoked</span>
                  )}
                </td>
                <td className="py-3 text-slate-600">{lastSeen(device.lastSeenAt)}</td>
                <td className="py-3 text-right">
                  {!device.revokedAt && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch(`/api/admin/devices/${device.id}`, { method: "DELETE" });
                        await load();
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-slate-500">
                  No tablets set up yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
