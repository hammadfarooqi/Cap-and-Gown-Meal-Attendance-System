"use client";

import { useCallback, useEffect, useState } from "react";
import { netidFromFilename } from "@/lib/photos/naming";
import { resizeHeadshot } from "@/lib/photos/resize";
import type { RosterEntry } from "@/app/api/admin/roster/route";

type Unmatched = { file: File; assignedTo: string };
type Result = { uploaded: number; failed: { name: string; reason: string }[] };

export function PhotosView() {
  const [members, setMembers] = useState<RosterEntry[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/roster");
    if (res.ok) setMembers((await res.json()).members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (netid: string, file: File): Promise<string | null> => {
    try {
      const resized = await resizeHeadshot(file);
      const form = new FormData();
      form.set("netid", netid);
      form.set("photo", new File([resized], `${netid}.webp`, { type: "image/webp" }));

      const res = await fetch("/api/admin/photos", { method: "POST", body: form });
      if (res.ok) return null;
      return (await res.json()).error ?? "Upload failed.";
    } catch (error) {
      return error instanceof Error ? error.message : "Could not read this image.";
    }
  };

  const handleFiles = async (files: File[]) => {
    setBusy(true);
    setResult(null);

    const matched: [string, File][] = [];
    const leftovers: Unmatched[] = [];

    for (const file of files) {
      const netid = netidFromFilename(file.name);
      if (netid) matched.push([netid, file]);
      else leftovers.push({ file, assignedTo: "" });
    }

    const failed: Result["failed"] = [];
    let uploaded = 0;

    for (const [index, [netid, file]] of matched.entries()) {
      setProgress({ done: index, total: matched.length });
      const error = await send(netid, file);
      if (error) failed.push({ name: file.name, reason: error });
      else uploaded += 1;
    }

    setProgress(null);
    setBusy(false);
    setUnmatched(leftovers);
    setResult({ uploaded, failed });
    await load();
  };

  const withPhoto = members.filter((m) => m.hasPhoto).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Photos</h1>
        <p className="max-w-2xl text-ink-secondary">
          Headshots appear when somebody checks in. Files named for a netID —
          <code className="mx-1 rounded bg-oxblood-wash px-1.5 py-0.5 text-sm">ab1234.jpg</code>
          — are matched automatically; anything else is listed below for you to
          assign. Nothing is guessed, because the wrong guess puts somebody
          else&rsquo;s face on a student&rsquo;s screen.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-6 ring-1 ring-line">
        <p data-testid="photo-coverage" className="text-lg">
          <strong>{withPhoto}</strong>{" "}
          <span className="text-ink-secondary">of {members.length} members have a photo</span>
        </p>

        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          aria-label="Headshot files"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void handleFiles(files);
            e.target.value = "";
          }}
          className="max-w-md text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-oxblood file:px-4 file:py-2 file:text-white"
        />

        {progress && (
          <p role="status" className="text-ink-secondary">
            Uploading {progress.done + 1} of {progress.total}…
          </p>
        )}

        {result && (
          <div data-testid="upload-result" className="flex flex-col gap-2">
            <p role="status" className="text-good">
              {result.uploaded} {result.uploaded === 1 ? "photo" : "photos"} uploaded.
            </p>
            {result.failed.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-secondary">
                {result.failed.slice(0, 10).map((f) => (
                  <li key={f.name}>
                    {f.name} — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {unmatched.length > 0 && (
        <section className="flex flex-col gap-4 rounded-2xl bg-surface p-6 ring-1 ring-line">
          <h2 className="text-lg font-semibold">
            {unmatched.length} {unmatched.length === 1 ? "file" : "files"} we could not place
          </h2>

          <ul className="flex flex-col gap-3">
            {unmatched.map((item, index) => (
              <li key={item.file.name} className="flex flex-wrap items-center gap-3">
                <span className="min-w-64 text-sm">{item.file.name}</span>

                <select
                  value={item.assignedTo}
                  aria-label={`Who is in ${item.file.name}?`}
                  onChange={(e) =>
                    setUnmatched((list) =>
                      list.map((entry, i) =>
                        i === index ? { ...entry, assignedTo: e.target.value } : entry,
                      ),
                    )
                  }
                  className="rounded-lg bg-page px-3 py-2 text-sm ring-1 ring-line-strong"
                >
                  <option value="">Choose a member…</option>
                  {members.map((member) => (
                    <option key={member.netid} value={member.netid}>
                      {member.fullName} ({member.netid})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={!item.assignedTo || busy}
                  onClick={async () => {
                    const error = await send(item.assignedTo, item.file);
                    if (!error) {
                      setUnmatched((list) => list.filter((_, i) => i !== index));
                      await load();
                    }
                  }}
                  className="rounded-lg px-4 py-2 text-sm ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash disabled:opacity-40"
                >
                  Save
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
