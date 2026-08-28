import type { Versions } from "@/lib/api/envelope";
import type { StationStore, QueuedItem } from "./store";
import type { StationApi } from "./api";
import { refreshIfStale } from "./bootstrap";

export type OutboxDeps = {
  store: StationStore;
  api: StationApi;
  deviceToken: string;
  /** Injectable so a test can assert the re-warm without a network. */
  refresh?: (deps: OutboxDeps, seen: Versions) => Promise<boolean>;
};

export type FlushResult = { sent: number; remaining: number };

/**
 * Only one flush may be in flight at a time.
 *
 * A scan triggers an immediate flush, and the background loop is also
 * ticking. Without this guard the two overlap, both read the same queued
 * items, and both send them. The server would dedupe the swipes, but the
 * bindings would collide and the outbox rows would be deleted twice.
 */
let inFlight = false;

export async function flushOutbox(deps: OutboxDeps): Promise<FlushResult> {
  if (inFlight) return { sent: 0, remaining: await deps.store.outboxSize() };
  inFlight = true;

  try {
    const items = await deps.store.peekOutbox();
    if (items.length === 0) return { sent: 0, remaining: 0 };

    const swipes = items.filter((i) => i.kind === "swipe");
    const bindings = items.filter((i) => i.kind === "binding");

    const done: number[] = [];

    // Bindings first: a binding that fails should not stop swipes going, but
    // sending them ahead means a newly bound card is known server-side by the
    // time anyone looks at the roster.
    /** The newest version stamps any response handed back this flush. */
    let seen: Versions | null = null;

    for (const binding of bindings) {
      // A binding queued by an older build has no `token`. Sending undefined
      // earns a 400, which is not in the drop list below, so it would sit in
      // the queue being retried every few seconds forever.
      if (!binding.token || !binding.netid) {
        done.push(binding.id);
        continue;
      }

      const result = await deps.api.bind(deps.deviceToken, binding.token, binding.netid);

      // 409 means the server refused: either that card belongs to somebody
      // else, or this person already has one and two lanes raced. Both are
      // final answers, and retrying forever would poison the queue.
      if (result.ok || result.status === 409 || result.status === 404) {
        done.push(binding.id);
      }
      if (result.ok) seen = result.versions;
    }

    if (swipes.length > 0) {
      const result = await deps.api.sync(deps.deviceToken, swipes);
      if (result.ok) {
        done.push(...swipes.map((s) => s.id));
        seen = result.versions;
      }
    }

    if (done.length > 0) await deps.store.removeFromOutbox(done);

    // Every station response carries the current version stamps, which is how
    // a tablet is meant to learn that the roster moved — off traffic it was
    // already sending, with no polling and no push. Nothing compared them
    // until now, so a running tablet only ever refreshed on page load: a
    // roster change, a photo upload, or a card bound on another lane stayed
    // invisible to it for the rest of service.
    if (seen) await (deps.refresh ?? refreshIfStale)(deps, seen);

    return { sent: done.length, remaining: await deps.store.outboxSize() };
  } finally {
    inFlight = false;
  }
}

export const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * Start the background drain. Returns a function that stops it.
 *
 * `onFlushed` exists because the queue is drained here but displayed
 * elsewhere. Without it the station's "waiting to sync" count is whatever it
 * was at the last scan: the loop empties the queue silently, and the number
 * sits there claiming a backlog that cleared minutes ago.
 */
export function startOutboxLoop(
  deps: OutboxDeps,
  intervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  onFlushed?: (result: FlushResult) => void,
): () => void {
  const timer = setInterval(() => {
    void flushOutbox(deps)
      .then((result) => onFlushed?.(result))
      .catch(() => {
        // A flush failure is normal — the network is down. The items stay
        // queued and the next tick tries again.
      });
  }, intervalMs);

  return () => clearInterval(timer);
}

/** Test-only: clears the in-flight guard between cases. */
export function __resetFlushGuard(): void {
  inFlight = false;
}

export type { QueuedItem };
