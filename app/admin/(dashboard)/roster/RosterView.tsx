"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RosterDiff } from "@/lib/roster/diff";
import type { RosterEntry } from "@/app/api/admin/roster/route";

type Preview = { diff: RosterDiff; largeDrop: boolean; memberCount: number };

export function RosterView() {
  const [members, setMembers] = useState<RosterEntry[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [confirmedLargeDrop, setConfirmedLargeDrop] = useState(false);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/roster");
    if (res.ok) setMembers((await res.json()).members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setErrors([]);
    setPreview(null);
    setApplied(null);
    setConfirmedLargeDrop(false);

    const res = await fetch("/api/admin/roster/preview", {
      method: "POST",
      body: await file.text(),
    });
    const body = await res.json();

    if (!res.ok) {
      setErrors(body.errors ?? [body.error ?? "That file could not be read."]);
      return;
    }
    setPreview(body);
  };

  const apply = async () => {
    if (!preview) return;
    setApplying(true);

    const res = await fetch("/api/admin/roster/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diff: preview.diff }),
    });
    setApplying(false);

    if (res.ok) {
      const result = await res.json();
      setApplied(
        `${result.added} added, ${result.updated} updated, ${result.dropped} no longer members.`,
      );
      setPreview(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    }
  };

  const removeOne = async (netid: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the club? Their past meals are kept.`)) return;
    await fetch(`/api/admin/roster/member?netid=${netid}`, { method: "DELETE" });
    await load();
  };

  const shown = query.trim()
    ? members.filter((m) =>
        `${m.fullName} ${m.netid}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : members;

  const blocked = Boolean(preview?.largeDrop) && !confirmedLargeDrop;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl">Roster</h1>
        <p className="max-w-2xl text-ink-secondary">
          Upload the membership spreadsheet as it comes — a Name and Email
          column pair per class year. Nothing changes until you read what it
          would do and say yes.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-6 ring-1 ring-line">
        <h2 className="text-lg font-semibold">Upload a spreadsheet</h2>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          aria-label="Membership spreadsheet"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="max-w-md text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-oxblood file:px-4 file:py-2 file:text-white"
        />

        {errors.length > 0 && (
          <div role="alert" data-testid="upload-errors" className="rounded-xl bg-oxblood-wash p-4 ring-1 ring-line">
            <p className="font-medium text-danger">Nothing was changed.</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-secondary">
              {errors.slice(0, 12).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {applied && (
          <p role="status" className="text-good">
            {applied}
          </p>
        )}

        {preview && (
          <div className="flex flex-col gap-4 rounded-xl bg-page p-5 ring-1 ring-line">
            <div className="flex flex-wrap gap-6 text-sm">
              <Count n={preview.diff.add.length} label="to add" testId="diff-add" />
              <Count n={preview.diff.update.length} label="to update" testId="diff-update" />
              <Count n={preview.diff.drop.length} label="no longer members" testId="diff-drop" />
              <Count n={preview.diff.unchanged} label="unchanged" testId="diff-unchanged" />
            </div>

            {preview.diff.drop.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-secondary">
                  Who stops being a member
                </summary>
                <ul className="mt-2 columns-2 text-ink-secondary">
                  {preview.diff.drop.map((person) => (
                    <li key={person.netid}>{person.fullName}</li>
                  ))}
                </ul>
              </details>
            )}

            {preview.largeDrop && (
              <div role="alert" data-testid="large-drop-warning" className="rounded-lg bg-oxblood-wash p-4 ring-1 ring-line-strong">
                {/* A truncated export is the realistic accident. It reads as
                    "remove everyone" and would silently end access for people
                    who are still members. */}
                <p className="font-medium">
                  This removes {preview.diff.drop.length} of {preview.memberCount} members.
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  That is a lot. If the file was cut short, close this and upload it again.
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmedLargeDrop}
                    onChange={(e) => setConfirmedLargeDrop(e.target.checked)}
                  />
                  I have checked the file and this is right
                </label>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={apply}
                disabled={applying || blocked}
                className="rounded-lg bg-oxblood px-5 py-2.5 text-white transition-colors duration-150 hover:bg-oxblood-bright disabled:opacity-40"
              >
                {applying ? "Applying…" : "Apply these changes"}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-sm text-ink-muted underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <AddMember onAdded={load} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {members.length} members
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search members"
            className="rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line-strong"
          />
        </div>

        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              <th scope="col" className="py-2 font-normal">Name</th>
              <th scope="col" className="py-2 font-normal">netID</th>
              <th scope="col" className="py-2 font-normal">Class</th>
              <th scope="col" className="py-2 font-normal">Photo</th>
              <th scope="col" className="py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((person) => (
              <tr key={person.netid} className="border-t border-line">
                <td className="py-2">{person.fullName}</td>
                <td className="py-2 text-ink-secondary">{person.netid}</td>
                <td className="py-2 text-ink-secondary">{person.classYear ?? "—"}</td>
                <td className="py-2 text-ink-secondary">{person.hasPhoto ? "Yes" : "—"}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeOne(person.netid, person.fullName)}
                    className="text-ink-muted underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-ink-muted">
                  {members.length === 0 ? "No members yet." : "Nobody matches that search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Count({ n, label, testId }: { n: number; label: string; testId: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <strong data-testid={testId} className="text-xl">{n}</strong>
      <span className="text-ink-secondary">{label}</span>
    </span>
  );
}

function AddMember({ onAdded }: { onAdded: () => void }) {
  const [netid, setNetid] = useState("");
  const [fullName, setFullName] = useState("");
  const [classYear, setClassYear] = useState("");

  const field = "rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-line-strong";

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-6 ring-1 ring-line">
      <h2 className="text-lg font-semibold">Add or correct one person</h2>
      <p className="text-sm text-ink-secondary">
        Quicker than a spreadsheet for a single typo, which is most of what
        comes up during term.
      </p>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await fetch("/api/admin/roster/member", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              netid,
              fullName,
              classYear: classYear ? Number(classYear) : null,
            }),
          });
          if (res.ok) {
            setNetid("");
            setFullName("");
            setClassYear("");
            onAdded();
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-ink-secondary">
          netID
          <input
            value={netid}
            onChange={(e) => setNetid(e.target.value)}
            aria-label="netID"
            autoCapitalize="none"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-secondary">
          Full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-label="Full name"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-secondary">
          Class year
          <input
            value={classYear}
            onChange={(e) => setClassYear(e.target.value)}
            aria-label="Class year"
            inputMode="numeric"
            className={`${field} w-24`}
          />
        </label>
        <button
          type="submit"
          disabled={!netid.trim() || !fullName.trim()}
          className="rounded-lg px-4 py-2 text-sm ring-1 ring-line-strong transition-colors duration-150 hover:bg-oxblood-wash disabled:opacity-40"
        >
          Save
        </button>
      </form>
    </section>
  );
}
