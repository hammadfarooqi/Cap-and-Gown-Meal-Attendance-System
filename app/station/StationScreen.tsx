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
import { Candidates } from "./Candidates";
import { GuestForm } from "./GuestForm";
import { ManualEntry } from "./ManualEntry";

/**
 * The rule this screen follows.
 *
 * A message that asks the person to DO something replaces "Scan your card"
 * and the input box, and waits — up to a minute — because somebody is standing
 * there reading it. A message that asks nothing appears BELOW the idle screen
 * and clears itself in three seconds, so the lane keeps moving and the next
 * person can swipe straight over it.
 */
export const NOTICE_MS = 3000;
/**
 * The one exception. "See an officer" asks nothing at the tablet, so it is a
 * notice — but it is the rarest message here and it is an instruction someone
 * has to read and act on. Three seconds is not enough to do that.
 */
export const OFFICER_NOTICE_MS = 10_000;
export const TAKEOVER_MS = 60_000;

/** Shown below the idle screen. Nothing here asks for a decision. */
type Notice =
  | { kind: "checked-in"; person: CachedPerson; mealPeriod: string; url: string | null }
  | { kind: "no-meal" }
  | { kind: "failed" }
  | { kind: "already-bound"; netid: string };

/** Replaces the idle screen. Each of these is waiting on a person. */
type Takeover =
  | { kind: "candidates"; token: string; candidates: CachedPerson[]; nameParts: string[] }
  | { kind: "guest-form"; card: string; nameParts: string[] };

const noticeDuration = (notice: Notice, base: number) =>
  notice.kind === "already-bound" ? OFFICER_NOTICE_MS : base;

export type StationScreenProps = {
  store: StationStore;
  api: StationApi;
  deviceToken: string;
  /** Injectable so tests can stand at a known moment. */
  now?: () => Date;
  /** Skip the network warm-up in tests that seed the store directly. */
  skipWarm?: boolean;
  /** Called when the server says this tablet is no longer enrolled. */
  onUnenrolled?: () => void;
  /** Overridable so tests need not fake timers, which breaks IndexedDB. */
  holdMs?: number;
  /** Likewise, so a test need not wait a minute for a takeover to lapse. */
  takeoverMs?: number;
};

export function StationScreen({
  store,
  api,
  deviceToken,
  now,
  skipWarm,
  holdMs = NOTICE_MS,
  takeoverMs = TAKEOVER_MS,
  onUnenrolled,
}: StationScreenProps) {
  const [warming, setWarming] = useState(!skipWarm);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const [unsynced, setUnsynced] = useState(0);
  const [mealName, setMealName] = useState<string | null>(null);
  const [clubs, setClubs] = useState<string[]>([]);

  // `now` arrives as a fresh closure on every render. Reading it through a
  // ref keeps it out of the effect dependency arrays — otherwise the warm-up
  // effect re-runs, sets state, re-renders, and loops forever.
  const nowRef = useRef(now);
  nowRef.current = now;
  const getNow = useCallback(() => nowRef.current?.() ?? new Date(), []);

  // Same reason as `now`: an inline callback from the parent is a new
  // function every render. In a dependency array it makes the warm-up effect
  // re-run and cancel its own previous run, so the callback never fires at
  // all — which is exactly how the first version of this failed.
  const unenrolledRef = useRef(onUnenrolled);
  unenrolledRef.current = onUnenrolled;
  const reportUnenrolled = useCallback(() => unenrolledRef.current?.(), []);

  const deps = { store, api, deviceToken, now: getNow };
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const takeoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeUrl = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (takeoverTimer.current) clearTimeout(takeoverTimer.current);
  }, []);

  /** Show a message below the idle screen, then let it clear itself. */
  const showNotice = useCallback(
    (next: Notice) => {
      clearTimers();

      // Revoke the previous photo before replacing it, or every scan leaks one.
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      activeUrl.current = next.kind === "checked-in" ? next.url : null;

      setTakeover(null);
      setNotice(next);
      noticeTimer.current = setTimeout(
        () => setNotice(null),
        noticeDuration(next, holdMs),
      );
    },
    [holdMs, clearTimers],
  );

  /**
   * Replace the idle screen with something that is waiting on a person.
   *
   * A scan that lands while one of these is up replaces it. The lane must
   * never jam, and the cost — whoever was deciding has to swipe again — is
   * smaller than a tablet stuck behind somebody who walked off.
   */
  const showTakeover = useCallback(
    (next: Takeover) => {
      clearTimers();
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      activeUrl.current = null;

      setNotice(null);
      setTakeover(next);
      takeoverTimer.current = setTimeout(() => setTakeover(null), takeoverMs);
    },
    [takeoverMs, clearTimers],
  );

  const returnToIdle = useCallback(() => {
    clearTimers();
    setTakeover(null);
    setNotice(null);
  }, [clearTimers]);

  const refreshLocalState = useCallback(async () => {
    const [clubList, queued, schedule] = await Promise.all([
      store.getClubs(),
      store.outboxSize(),
      store.getSchedule(),
    ]);
    setClubs(clubList);
    setUnsynced(queued);
    setMealName(deriveMeal(getNow(), schedule)?.mealPeriod ?? null);
  }, [store, getNow]);

  // Warm the cache, then start serving.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!skipWarm) {
        const warmed = await warmCache({ store, api, deviceToken });
        if (cancelled) return;
        if (!warmed.ok && warmed.unenrolled) {
          reportUnenrolled();
          return;
        }
      }
      if (cancelled) return;
      await refreshLocalState();
      if (!cancelled) setWarming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, api, deviceToken, skipWarm, refreshLocalState, reportUnenrolled]);

  // Drain the outbox in the background.
  useEffect(() => {
    const stop = startOutboxLoop({ store, api, deviceToken });
    return stop;
  }, [store, api, deviceToken]);

  const finish = useCallback(
    async (outcome: Awaited<ReturnType<typeof resolveScan>>) => {
      if (outcome.kind === "checked-in") {
        showNotice({
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
      } else if (outcome.kind === "candidates") {
        showTakeover({
          kind: "candidates",
          token: outcome.token,
          candidates: outcome.candidates,
          nameParts: outcome.nameParts,
        });
      } else if (outcome.kind === "unenrolled") {
        // No amount of retrying fixes a dead token. Hand the tablet back to
        // the enrolment screen rather than showing a network error forever.
        reportUnenrolled();
      } else if (outcome.kind === "already-bound") {
        showNotice({ kind: "already-bound", netid: outcome.netid });
      } else {
        showNotice({ kind: outcome.kind });
      }
      await refreshLocalState();
    },
    [store, api, deviceToken, showNotice, showTakeover, refreshLocalState, reportUnenrolled],
  );

  const submitManual = useCallback(
    async (value: string) => {
      await finish(await resolveScan(value, deps, "manual"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finish, store, api, deviceToken],
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
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (takeoverTimer.current) clearTimeout(takeoverTimer.current);
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    };
  }, []);

  if (warming) {
    return (
      <main className="station-dark flex min-h-screen flex-col items-center justify-center gap-6 bg-page p-8 text-ink">
        <p data-testid="warming" className="text-2xl text-ink-muted">
          Preparing…
        </p>
      </main>
    );
  }

  return (
    <main className="station-dark flex min-h-screen flex-col items-center justify-center gap-6 bg-page p-8 text-ink">
      {takeover?.kind === "candidates" && (
        <Candidates
          people={takeover.candidates}
          onPick={async (netid) => finish(await bindMember(takeover.token, netid, deps))}
          onGuest={() =>
            showTakeover({
              kind: "guest-form",
              card: takeover.token,
              nameParts: takeover.nameParts,
            })
          }
          onCancel={returnToIdle}
        />
      )}

      {takeover?.kind === "guest-form" && (
        <GuestForm
          clubs={clubs}
          onCancel={returnToIdle}
          onSubmit={async (netid, club) =>
            finish(await createGuest(takeover.card, netid, club, deps, takeover.nameParts))
          }
        />
      )}

      {/* The base. Present whenever nothing is waiting on a person, so the
          next person in the queue can swipe over whatever is on screen. */}
      {!takeover && (
        <>
          <p data-testid="idle" className="text-4xl font-light text-ink-secondary">
            Scan your card
          </p>
          {mealName && (
            <p
              data-testid="meal-name"
              className="text-sm uppercase tracking-[0.3em] text-ink-muted"
            >
              {mealName}
            </p>
          )}
          {unsynced > 0 && (
            <p data-testid="unsynced" className="text-sm text-ink-muted">
              {unsynced} waiting to sync
            </p>
          )}

          <ManualEntry onSubmit={submitManual} />

          {notice && (
            <div
              data-testid="notice"
              className="mt-4 flex flex-col items-center gap-3 border-t border-line-strong pt-8"
            >
              {notice.kind === "checked-in" && (
                <>
                  <Avatar name={notice.person.fullName} url={notice.url} size="tile" />
                  {/* The serif carries the member's name here and the club's
                      name in the dashboard header. Those two places only. */}
                  <p data-testid="name" className="font-display text-4xl">
                    {notice.person.fullName}
                  </p>
                  <p
                    data-testid="checked-in"
                    className="text-lg uppercase tracking-[0.2em] text-ink-secondary"
                  >
                    Checked in for {notice.mealPeriod}
                  </p>
                </>
              )}

              {notice.kind === "no-meal" && (
                <p data-testid="no-meal" className="text-2xl text-ink-secondary">
                  No meal is running right now
                </p>
              )}

              {notice.kind === "failed" && (
                <p data-testid="failed" className="max-w-2xl text-center text-2xl text-ink">
                  Could not reach the server —{" "}
                  <span className="text-ink-secondary">not counted</span>
                </p>
              )}

              {notice.kind === "already-bound" && (
                <p data-testid="already-bound" className="max-w-2xl text-center text-2xl text-ink">
                  That person already has a card —{" "}
                  <span className="text-ink-secondary">please see an officer</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
