import type { Versions } from "@/lib/api/envelope";
import type { StationStore } from "./store";
import type { StationApi } from "./api";

/** Headshots come from a private bucket through an authenticated route. */
export const PHOTO_BASE_PATH = "/api/photos";

/**
 * Three tablets warming at once over club Wi-Fi must not open 300 parallel
 * connections. Six at a time keeps the pipe busy without drowning it.
 */
export const PHOTO_CONCURRENCY = 6;

export type PhotoFetcher = (path: string) => Promise<Blob | null>;

/**
 * The bucket is private, so this carries the tablet's device token. A public
 * bucket would put every student's face behind a guessable URL.
 *
 * photoPath is stored as "<netid>.webp"; the route takes the netID.
 */
export function makePhotoFetcher(deviceToken: string): PhotoFetcher {
  return async (path) => {
    const netid = path.replace(/\.webp$/i, "");
    try {
      const res = await fetch(`${PHOTO_BASE_PATH}/${netid}`, {
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  };
}

export type BootstrapDeps = {
  store: StationStore;
  api: StationApi;
  deviceToken: string;
  fetchPhoto?: PhotoFetcher;
};

/** Run `worker` over `items`, at most `limit` at a time. */
async function pooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await worker(items[next++]);
    }
  });
  await Promise.all(runners);
}

/**
 * Download only the headshots the tablet does not already hold.
 *
 * This is the difference between ~12MB on first launch and a few kilobytes on
 * every launch after. A single failure is swallowed on purpose: one missing
 * photo must not cost the other 299, and a person with no photo still checks
 * in perfectly — the avatar falls back to their initials.
 */
async function cachePhotos(deps: BootstrapDeps, paths: string[]): Promise<number> {
  const fetchPhoto = deps.fetchPhoto ?? makePhotoFetcher(deps.deviceToken);

  const missing: string[] = [];
  for (const path of paths) {
    if (!(await deps.store.hasPhoto(path))) missing.push(path);
  }

  let stored = 0;
  await pooled(missing, PHOTO_CONCURRENCY, async (path) => {
    const blob = await fetchPhoto(path);
    if (!blob) return;
    await deps.store.putPhoto(path, blob);
    stored += 1;
  });

  return stored;
}

/**
 * Fetch everything the tablet needs and cache it.
 *
 * Returns null if the server could not be reached — the caller keeps
 * whatever cache it already had rather than emptying a working tablet.
 */
export async function warmCache(
  deps: BootstrapDeps,
): Promise<{ people: number; photos: number } | null> {
  const result = await deps.api.bootstrap(deps.deviceToken);
  if (!result.ok) return null;

  await deps.store.putBootstrap({
    people: result.data.people,
    credentials: result.data.credentials,
    schedule: result.data.schedule,
    clubs: result.data.clubs,
    versions: result.versions,
  });

  const paths = result.data.people
    .map((p) => p.photoPath)
    .filter((p): p is string => Boolean(p));

  const photos = await cachePhotos(deps, paths);

  return { people: result.data.people.length, photos };
}

/**
 * Re-warm only when a version stamp has actually moved.
 *
 * `seen` comes from the envelope on any response the tablet just received,
 * so a roster change made in the dashboard reaches every tablet on its next
 * outbox flush — no polling, no push.
 */
export async function refreshIfStale(deps: BootstrapDeps, seen: Versions): Promise<boolean> {
  const held = await deps.store.getVersions();
  if (held && held.roster === seen.roster && held.schedule === seen.schedule) {
    return false;
  }

  return (await warmCache(deps)) !== null;
}

/**
 * An object URL for a cached headshot, or null when there is none.
 *
 * Null is an ordinary outcome, not an error: headshots are open question O5
 * and may not arrive before go-live. The caller renders initials instead.
 * The caller also owns revoking the URL.
 */
export async function photoUrl(
  store: StationStore,
  photoPath: string | null,
): Promise<string | null> {
  if (!photoPath) return null;
  const blob = await store.getPhoto(photoPath);
  return blob ? URL.createObjectURL(blob) : null;
}
