import type { Versions } from "@/lib/api/envelope";
import type { CachedPerson, Credential, OutboxItem } from "./store";
import type { MealWindow } from "@/lib/meals/types";

export type ApiResult<T> =
  | { ok: true; data: T; versions: Versions }
  /** `status` is null when the network never answered at all. */
  | { ok: false; status: number | null };

export type BootstrapPayload = {
  people: CachedPerson[];
  credentials: Credential[];
  schedule: MealWindow[];
};

/**
 * Spec A6: an operation that needs the server gets roughly three seconds in
 * total, then it is abandoned. A student is standing at the tablet, and a
 * lost count is better than a frozen lane.
 */
export const ATTEMPT_TIMEOUT_MS = 1000;
export const MAX_ATTEMPTS = 3;

export type TimingOptions = {
  attemptTimeoutMs?: number;
  maxAttempts?: number;
};

async function request<T>(
  path: string,
  deviceToken: string,
  init: RequestInit,
  timing: TimingOptions = {},
): Promise<ApiResult<T>> {
  const attemptTimeoutMs = timing.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const maxAttempts = timing.maxAttempts ?? MAX_ATTEMPTS;

  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);

    try {
      const res = await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${deviceToken}`,
          ...(init.headers ?? {}),
        },
      });

      if (res.ok) {
        const body = await res.json();
        return { ok: true, data: body.data as T, versions: body.versions as Versions };
      }

      // A 4xx is an answer, not a failure. Retrying a rejected token or an
      // unknown card just wastes the budget the next person is waiting on.
      if (res.status < 500) return { ok: false, status: res.status };

      lastStatus = res.status;
    } catch {
      // Network error or our own abort. Both are worth another try.
      lastStatus = null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: lastStatus };
}

export const api = {
  bootstrap: (deviceToken: string, timing?: TimingOptions) =>
    request<BootstrapPayload>("/api/bootstrap", deviceToken, { method: "GET" }, timing),

  resolve: (deviceToken: string, card: string, timing?: TimingOptions) =>
    request<CachedPerson>(
      "/api/resolve",
      deviceToken,
      { method: "POST", body: JSON.stringify({ token: card }) },
      timing,
    ),

  bind: (deviceToken: string, card: string, netid: string, timing?: TimingOptions) =>
    request<{ token: string; netid: string }>(
      "/api/bind",
      deviceToken,
      { method: "POST", body: JSON.stringify({ token: card, netid }) },
      timing,
    ),

  createGuest: (
    deviceToken: string,
    netid: string,
    homeClub: string,
    card: string | null,
    timing?: TimingOptions,
  ) =>
    request<CachedPerson>(
      "/api/guests",
      deviceToken,
      { method: "POST", body: JSON.stringify({ netid, homeClub, token: card }) },
      timing,
    ),

  sync: (deviceToken: string, items: OutboxItem[], timing?: TimingOptions) =>
    request<{ accepted: number; skipped: number }>(
      "/api/sync",
      deviceToken,
      {
        method: "POST",
        body: JSON.stringify({
          swipes: items
            .filter((i) => i.kind === "swipe")
            .map((i) => ({
              netid: i.netid,
              scannedAt: i.scannedAt,
              entryMethod: i.entryMethod,
            })),
        }),
      },
      timing,
    ),
};

export type StationApi = typeof api;
