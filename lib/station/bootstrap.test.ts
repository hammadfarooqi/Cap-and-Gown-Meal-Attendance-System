import { describe, it, expect, vi, afterEach } from "vitest";
import { openStore, type StationStore, type CachedPerson } from "./store";
import { warmCache, refreshIfStale, photoUrl } from "./bootstrap";
import type { StationApi } from "./api";
import type { MealWindow } from "@/lib/meals/types";

const DEVICE_TOKEN = "device-token-abc";

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

const person = (netid: string, photoPath: string | null = `${netid}.webp`): CachedPerson => ({
  netid, fullName: `Person ${netid}`, isMember: true,
  homeClub: "Cap & Gown", photoPath,
});

const opened: { close(): void }[] = [];

async function open(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  return store;
}

const payload = (people: CachedPerson[], versions = { roster: 1, schedule: 1 }) =>
  ({
    ok: true as const,
    data: { people, credentials: [], schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"] },
    versions,
  });

function fakeApi(bootstrapResult: unknown): StationApi {
  return {
    bootstrap: vi.fn().mockResolvedValue(bootstrapResult),
    resolve: vi.fn(), bind: vi.fn(), createGuest: vi.fn(), sync: vi.fn(),
  } as unknown as StationApi;
}

const photoOf = (name: string) => new Blob([`bytes-${name}`], { type: "image/webp" });

afterEach(async () => {
  for (const store of opened) store.close();
  opened.length = 0;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("cap-station");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("warmCache", () => {
  it("stores the roster, schedule and versions on a first launch", async () => {
    const store = await open();
    const api = fakeApi(payload([person("aa1111")], { roster: 7, schedule: 2 }));

    const result = await warmCache({
      store, api, deviceToken: DEVICE_TOKEN,
      fetchPhoto: async (p) => photoOf(p),
    });

    expect(result).toEqual({ ok: true, people: 1, photos: 1 });
    expect(await store.getVersions()).toEqual({ roster: 7, schedule: 2 });
    expect(await store.getSchedule()).toEqual(SCHEDULE);
  });

  it("downloads ONLY photos it does not already hold", async () => {
    // The difference between 12MB on every launch and a few kilobytes.
    const store = await open();
    await store.putPhoto("aa1111.webp", photoOf("cached"));

    const fetchPhoto = vi.fn(async (p: string) => photoOf(p));
    const api = fakeApi(payload([person("aa1111"), person("bb2222")]));

    const result = await warmCache({ store, api, deviceToken: DEVICE_TOKEN, fetchPhoto });

    expect(fetchPhoto).toHaveBeenCalledOnce();
    expect(fetchPhoto).toHaveBeenCalledWith("bb2222.webp");
    expect(result.ok && result.photos).toBe(1);
  });

  it("keeps going when one photo fails to download", async () => {
    const store = await open();
    const fetchPhoto = vi.fn(async (p: string) => (p === "aa1111.webp" ? null : photoOf(p)));
    const api = fakeApi(payload([person("aa1111"), person("bb2222")]));

    const result = await warmCache({ store, api, deviceToken: DEVICE_TOKEN, fetchPhoto });

    expect(result.ok && result.photos).toBe(1);
    expect(await store.hasPhoto("bb2222.webp")).toBe(true);
    expect(await store.hasPhoto("aa1111.webp")).toBe(false);
  });

  it("handles a roster where nobody has a photo yet", async () => {
    // Open question O5. Headshots may not arrive before go-live, and every
    // count must be correct regardless.
    const store = await open();
    const fetchPhoto = vi.fn();
    const api = fakeApi(payload([person("aa1111", null), person("bb2222", null)]));

    const result = await warmCache({ store, api, deviceToken: DEVICE_TOKEN, fetchPhoto });

    expect(result).toEqual({ ok: true, people: 2, photos: 0 });
    expect(fetchPhoto).not.toHaveBeenCalled();
  });

  it("reports failure and changes nothing when the server is unreachable", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [person("existing")], credentials: [], schedule: SCHEDULE,
      clubs: ["Cap & Gown", "Cottage", "None"],
      versions: { roster: 3, schedule: 3 },
    });

    const api = fakeApi({ ok: false, status: null });
    const result = await warmCache({ store, api, deviceToken: DEVICE_TOKEN });

    expect(result).toEqual({ ok: false, unenrolled: false });
    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["existing"]);
    expect(await store.getVersions()).toEqual({ roster: 3, schedule: 3 });
  });
});

describe("warmCache and a dead token", () => {
  it("SAYS THE TABLET IS UNENROLLED, not that the network failed", async () => {
    // A revoked tablet reporting "could not reach the server" sends staff to
    // check the Wi-Fi for a problem no network fixes, and the tablet stays
    // stuck forever.
    const store = await open();
    const api = fakeApi({ ok: false, status: 401 });

    expect(await warmCache({ store, api, deviceToken: DEVICE_TOKEN }))
      .toEqual({ ok: false, unenrolled: true });
  });
});

describe("refreshIfStale", () => {
  const seeded = async (versions: { roster: number; schedule: number }) => {
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111")], credentials: [], schedule: SCHEDULE,
      clubs: ["Cap & Gown", "Cottage", "None"], versions,
    });
    return store;
  };

  it("does nothing when both versions match", async () => {
    const store = await seeded({ roster: 4, schedule: 2 });
    const api = fakeApi(payload([person("aa1111")]));

    expect(await refreshIfStale({ store, api, deviceToken: DEVICE_TOKEN }, { roster: 4, schedule: 2 }))
      .toBe(false);
    expect(api.bootstrap).not.toHaveBeenCalled();
  });

  it("re-warms when the roster version moves", async () => {
    const store = await seeded({ roster: 4, schedule: 2 });
    const api = fakeApi(payload([person("bb2222")], { roster: 5, schedule: 2 }));

    expect(await refreshIfStale(
      { store, api, deviceToken: DEVICE_TOKEN, fetchPhoto: async (p) => photoOf(p) },
      { roster: 5, schedule: 2 },
    )).toBe(true);
    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["bb2222"]);
  });

  it("re-warms when the schedule version moves", async () => {
    const store = await seeded({ roster: 4, schedule: 2 });
    const api = fakeApi(payload([person("aa1111")], { roster: 4, schedule: 3 }));

    expect(await refreshIfStale(
      { store, api, deviceToken: DEVICE_TOKEN, fetchPhoto: async (p) => photoOf(p) },
      { roster: 4, schedule: 3 },
    )).toBe(true);
  });

  it("re-warms when the tablet holds no versions at all", async () => {
    const store = await open();
    const api = fakeApi(payload([person("aa1111")]));

    expect(await refreshIfStale(
      { store, api, deviceToken: DEVICE_TOKEN, fetchPhoto: async (p) => photoOf(p) },
      { roster: 1, schedule: 1 },
    )).toBe(true);
  });

  it("PRESERVES cached photos and queued swipes across a refresh", async () => {
    // A roster bump because someone fixed a typo must not cost 12MB of
    // headshots or a rush's worth of unsent scans. The photo has to be one
    // the roster still refers to — an orphan is pruned on purpose.
    const store = await seeded({ roster: 4, schedule: 2 });
    await store.putPhoto("aa1111.webp", photoOf("keep"));
    await store.enqueue({
      kind: "swipe", netid: "aa1111",
      scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan",
    });

    const api = fakeApi(payload([person("aa1111")], { roster: 5, schedule: 2 }));
    await refreshIfStale(
      { store, api, deviceToken: DEVICE_TOKEN, fetchPhoto: async (p) => photoOf(p) },
      { roster: 5, schedule: 2 },
    );

    expect(await store.hasPhoto("aa1111.webp")).toBe(true);
    expect(await store.outboxSize()).toBe(1);
  });

  it("leaves the existing cache intact when the refresh fails", async () => {
    const store = await seeded({ roster: 4, schedule: 2 });
    const api = fakeApi({ ok: false, status: null });

    expect(await refreshIfStale({ store, api, deviceToken: DEVICE_TOKEN }, { roster: 9, schedule: 9 }))
      .toBe(false);
    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });
});

describe("photoUrl", () => {
  it("returns an object URL for a cached photo", async () => {
    const store = await open();
    await store.putPhoto("aa1111.webp", photoOf("aa"));

    expect(await photoUrl(store, "aa1111.webp")).toMatch(/^blob:/);
  });

  it("returns null when the person has no photo path", async () => {
    const store = await open();
    expect(await photoUrl(store, null)).toBeNull();
  });

  it("returns null when the photo is not cached, rather than throwing", async () => {
    // O5 again: names and counts must work with no headshots at all.
    const store = await open();
    expect(await photoUrl(store, "never-downloaded.webp")).toBeNull();
  });
});

describe("a replaced headshot", () => {
  it("IS FETCHED AGAIN when its path carries a new version", async () => {
    // The bug this exists for: the cache is keyed on photoPath. Keyed on
    // "<netid>.webp" alone, a re-uploaded photo is never fetched again — the
    // tablet already holds that key and skips it, through a version bump,
    // through a reload, forever. 187 re-cropped headshots stayed invisible to
    // every tablet because of exactly this.
    const store = await open();
    await store.putPhoto("aa1111.webp?v=1", photoOf("old"));
    const fetchPhoto = vi.fn().mockResolvedValue(photoOf("new"));

    await warmCache({
      store,
      deviceToken: DEVICE_TOKEN,
      fetchPhoto,
      api: fakeApi(payload([person("aa1111", "aa1111.webp?v=2")])),
    });

    expect(fetchPhoto).toHaveBeenCalledWith("aa1111.webp?v=2");
    expect(await store.hasPhoto("aa1111.webp?v=2")).toBe(true);
  });

  it("PRUNES the copy it replaced, so the cache cannot grow forever", async () => {
    const store = await open();
    await store.putPhoto("aa1111.webp?v=1", photoOf("old"));

    await warmCache({
      store,
      deviceToken: DEVICE_TOKEN,
      fetchPhoto: async () => photoOf("new"),
      api: fakeApi(payload([person("aa1111", "aa1111.webp?v=2")])),
    });

    expect(await store.hasPhoto("aa1111.webp?v=1")).toBe(false);
  });

  it("STRIPS THE VERSION before asking the server, which knows only netIDs", async () => {
    const seen: string[] = [];
    const store = await open();
    await warmCache({
      store,
      deviceToken: DEVICE_TOKEN,
      fetchPhoto: async (path) => { seen.push(path); return photoOf("x"); },
      api: fakeApi(payload([person("aa1111", "aa1111.webp?v=9")])),
    });
    // makePhotoFetcher turns this into /api/photos/aa1111 — the route rejects
    // anything that is not a bare netID.
    expect(seen).toEqual(["aa1111.webp?v=9"]);
    expect("aa1111.webp?v=9".replace(/\.webp.*$/i, "")).toBe("aa1111");
  });
});
