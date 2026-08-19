"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onScan } from "@/lib/scan/burst";
import { deriveMeal } from "@/lib/meals/derive";
import { flushOutbox, startOutboxLoop } from "@/lib/station/outbox";
import { resolveScan } from "@/lib/station/resolve";
import { bindMember, createGuest } from "@/lib/station/prompt";
import { photoUrl, warmCache } from "@/lib/station/bootstrap";
import type { StationStore, CachedPerson } from "@/lib/station/store";
import type { StationApi } from "@/lib/station/api";
import { Avatar } from "./Avatar";
import { MemberPicker } from "./MemberPicker";
import { GuestForm } from "./GuestForm";

/** How long a result stays up before the screen returns to idle. */
export const RESULT_HOLD_MS = 3000;

type Screen =
  | { kind: "warming" }
  | { kind: "idle" }
  | { kind: "checked-in"; person: CachedPerson; mealPeriod: string; url: string | null }
  | { kind: "no-meal" }
  | { kind: "prompt"; card: string }
  | { kind: "member-picker"; card: string }
  | { kind: "guest-form"; card: string }
  | { kind: "failed" };

export type StationScreenProps = {
  store: StationStore;
  api: StationApi;
  deviceToken: string;
  /** Injectable so tests can stand at a known moment. */
  now?: () => Date;
  /** Skip the network warm-up in tests that seed the store directly. */
  skipWarm?: boolean;
  /** Overridable so tests need not fake timers, which breaks IndexedDB. */
  holdMs?: number;
};

export function StationScreen({
  store,
  api,
  deviceToken,
  now,
  skipWarm,
  holdMs = RESULT_HOLD_MS,
}: StationScreenProps) {
  const [screen, setScreen] = useState<Screen>(skipWarm ? { kind: "idle" } : { kind: "warming" });
  const [unsynced, setUnsynced] = useState(0);
  const [mealName, setMealName] = useState<string | null>(null);
  const [members, setMembers] = useState<{ all: CachedPerson[]; unbound: CachedPerson[] }>({
    all: [],
    unbound: [],
  });
  const [clubs, setClubs] = useState<string[]>([]);

  // `now` arrives as a fresh closure on every render. Reading it through a
  // ref keeps it out of the effect dependency arrays — otherwise the warm-up
  // effect re-runs, sets state, re-renders, and loops forever.
  const nowRef = useRef(now);
  nowRef.current = now;
  const getNow = useCallback(() => nowRef.current?.() ?? new Date(), []);

  const deps = { store, api, deviceToken, now: getNow };
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeUrl = useRef<string | null>(null);

  /** Show a result, then fall back to idle unless another scan lands first. */
  const hold = useCallback((next: Screen) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);

    // Revoke the previous photo before replacing it, or every scan leaks one.
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = next.kind === "checked-in" ? next.url : null;

    setScreen(next);
    holdTimer.current = setTimeout(() => setScreen({ kind: "idle" }), holdMs);
  }, [holdMs]);

  const refreshLocalState = useCallback(async () => {
    const [all, unbound, clubList, queued, schedule] = await Promise.all([
      store.allMembers(),
      store.unboundMembers(),
      store.getClubs(),
      store.outboxSize(),
      store.getSchedule(),
    ]);
    setMembers({ all, unbound });
    setClubs(clubList);
    setUnsynced(queued);
    setMealName(deriveMeal(getNow(), schedule)?.mealPeriod ?? null);
  }, [store, getNow]);

  // Warm the cache, then start serving.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!skipWarm) await warmCache({ store, api, deviceToken });
      if (cancelled) return;
      await refreshLocalState();
      if (!cancelled) setScreen({ kind: "idle" });
    })();
    return () => {
      cancelled = true;
    };
  }, [store, api, deviceToken, skipWarm, refreshLocalState]);

  // Drain the outbox in the background.
  useEffect(() => {
    const stop = startOutboxLoop({ store, api, deviceToken });
    return stop;
  }, [store, api, deviceToken]);

  const finish = useCallback(
    async (outcome: Awaited<ReturnType<typeof resolveScan>>) => {
      if (outcome.kind === "checked-in") {
        hold({
          kind: "checked-in",
          person: outcome.person,
          mealPeriod: outcome.mealPeriod,
          url: await photoUrl(store, outcome.person.photoPath),
        });
        // Nudge the queue immediately rather than waiting for the next tick.
        // A failure here is expected and harmless — the loop retries — but it
        // must be caught, or a closed database or a dead network surfaces as
        // an unhandled rejection.
        void flushOutbox({ store, api, deviceToken }).catch(() => {});
      } else if (outcome.kind === "prompt") {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        setScreen({ kind: "prompt", card: outcome.card });
      } else {
        hold({ kind: outcome.kind });
      }
      await refreshLocalState();
    },
    [store, api, deviceToken, hold, refreshLocalState],
  );

  // Card reader. Attached to the document, so nothing can steal focus from it.
  useEffect(() => {
    return onScan(async (card) => {
      await finish(await resolveScan(card, deps));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, store, api, deviceToken]);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {screen.kind === "warming" && (
        <p data-testid="warming" className="text-2xl text-slate-500">
          Preparing…
        </p>
      )}

      {screen.kind === "idle" && (
        <>
          <p data-testid="idle" className="text-3xl text-slate-500">
            Scan your card
          </p>
          {mealName && (
            <p data-testid="meal-name" className="text-lg uppercase tracking-widest text-slate-400">
              {mealName}
            </p>
          )}
          {unsynced > 0 && (
            <p data-testid="unsynced" className="text-sm text-slate-400">
              {unsynced} waiting to sync
            </p>
          )}
        </>
      )}

      {screen.kind === "checked-in" && (
        <>
          <Avatar name={screen.person.fullName} url={screen.url} />
          <p data-testid="name" className="text-5xl font-semibold">
            {screen.person.fullName}
          </p>
          <p data-testid="checked-in" className="text-2xl text-green-700">
            Checked in for {screen.mealPeriod}
          </p>
        </>
      )}

      {screen.kind === "no-meal" && (
        <p data-testid="no-meal" className="text-3xl text-slate-600">
          No meal is running right now
        </p>
      )}

      {screen.kind === "failed" && (
        <p data-testid="failed" className="text-3xl text-red-700">
          Could not reach the server — not counted
        </p>
      )}

      {screen.kind === "prompt" && (
        <div className="flex flex-col items-center gap-6">
          <p data-testid="prompt" className="text-3xl">
            Card not recognised
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setScreen({ kind: "member-picker", card: screen.card })}
              className="rounded-lg bg-slate-900 px-8 py-4 text-xl text-white"
            >
              Member
            </button>
            <button
              type="button"
              onClick={() => setScreen({ kind: "guest-form", card: screen.card })}
              className="rounded-lg border border-slate-400 px-8 py-4 text-xl"
            >
              Guest
            </button>
          </div>
          <button
            type="button"
            onClick={() => setScreen({ kind: "idle" })}
            className="text-slate-500 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {screen.kind === "member-picker" && (
        <MemberPicker
          all={members.all}
          unbound={members.unbound}
          onCancel={() => setScreen({ kind: "idle" })}
          onPick={async (netid) => finish(await bindMember(screen.card, netid, deps))}
        />
      )}

      {screen.kind === "guest-form" && (
        <GuestForm
          clubs={clubs}
          onCancel={() => setScreen({ kind: "idle" })}
          onSubmit={async (netid, club) =>
            finish(await createGuest(screen.card, netid, club, deps))
          }
        />
      )}
    </main>
  );
}
