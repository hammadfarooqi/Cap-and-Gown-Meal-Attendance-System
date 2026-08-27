import { describe, it, expect, vi, afterEach } from "vitest";
import { openStore, type StationStore, type CachedPerson } from "./store";
import { resolveScan } from "./resolve";
import type { StationApi } from "./api";
import type { MealWindow } from "@/lib/meals/types";

const DEVICE_TOKEN = "device-token-abc";

// Wednesday 2026-09-02, 12:00 New York.
const DURING_LUNCH = new Date("2026-09-02T16:00:00.000Z");
// Wednesday 2026-09-02, 15:00 New York — between meals.
const BETWEEN_MEALS = new Date("2026-09-02T19:00:00.000Z");

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

const MEMBER: CachedPerson = {
  netid: "aa1111",
  fullName: "Cached Member",
  isMember: true,
  homeClub: "Cap & Gown",
  photoPath: "aa1111.webp",
};

const opened: { close(): void }[] = [];

async function seeded(credentials: { token: string; netid: string }[] = []): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  await store.putBootstrap({
    people: [MEMBER],
    credentials,
    schedule: SCHEDULE,
    clubs: ["Cap & Gown", "Cottage", "None"],
    versions: { roster: 1, schedule: 1 },
  });
  return store;
}

const okResult = <T,>(data: T) =>
  ({ ok: true as const, data, versions: { roster: 1, schedule: 1 } });

function fakeApi(over: Partial<StationApi> = {}): StationApi {
  return {
    bootstrap: vi.fn(),
    resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    bind: vi.fn(),
    createGuest: vi.fn(),
    sync: vi.fn(),
    ...over,
  } as unknown as StationApi;
}

const deps = (store: StationStore, api: StationApi, now = DURING_LUNCH) =>
  ({ store, api, deviceToken: DEVICE_TOKEN, now: () => now });

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

describe("resolveScan", () => {
  it("reports no meal outside every window, queuing nothing and calling nobody", async () => {
    const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
    const api = fakeApi();

    const outcome = await resolveScan("CARD-1", deps(store, api, BETWEEN_MEALS));

    expect(outcome).toEqual({ kind: "no-meal" });
    expect(await store.outboxSize()).toBe(0);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  describe("case 1 — the token is cached", () => {
    it("checks the person in with no network call at all", async () => {
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      const api = fakeApi();

      const outcome = await resolveScan("CARD-1", deps(store, api));

      expect(outcome).toEqual({
        kind: "checked-in",
        person: MEMBER,
        mealPeriod: "lunch",
      });
      expect(api.resolve).not.toHaveBeenCalled();
      expect(await store.outboxSize()).toBe(1);
    });

    it("resolves even while the network hangs forever", async () => {
      // The 500ms budget depends on this path never awaiting the network.
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      const api = fakeApi({
        resolve: vi.fn().mockImplementation(() => new Promise(() => {})),
      } as Partial<StationApi>);

      const outcome = await resolveScan("CARD-1", deps(store, api));

      expect(outcome.kind).toBe("checked-in");
    });
  });

  describe("case 2 — not cached, the server knows the card", () => {
    it("checks them in and caches the answer", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      const outcome = await resolveScan("CARD-NEW", deps(store, api));

      expect(outcome.kind).toBe("checked-in");
      expect((await store.resolveToken("CARD-NEW"))?.netid).toBe("aa1111");
      expect(await store.outboxSize()).toBe(1);
    });

    it("makes the second scan of that card a cache hit", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      await resolveScan("CARD-NEW", deps(store, api));
      await resolveScan("CARD-NEW", deps(store, api));

      expect(api.resolve).toHaveBeenCalledOnce();
      expect(await store.outboxSize()).toBe(2);
    });

    it("caches a person it had never heard of, such as a guest bound elsewhere", async () => {
      const guest: CachedPerson = {
        netid: "gg9999", fullName: "Guest", isMember: false,
        homeClub: "Cottage", photoPath: null,
      };
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(guest)) } as Partial<StationApi>);

      await resolveScan("CARD-G", deps(store, api));

      expect((await store.resolveToken("CARD-G"))?.fullName).toBe("Guest");
    });
  });

  describe("case 3 — not cached, the server has never seen the card", () => {
    it("asks for the member-or-guest prompt", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      expect(await resolveScan("CARD-X", deps(store, api)))
        .toEqual({ kind: "prompt", cards: ["CARD-X"], nameParts: [] });
      expect(await store.outboxSize()).toBe(0);
    });
  });

  describe("case 4 — not cached, the server does not answer", () => {
    it("still asks for the prompt, so a member can be bound offline", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: null }) } as Partial<StationApi>);

      expect(await resolveScan("CARD-X", deps(store, api)))
        .toEqual({ kind: "prompt", cards: ["CARD-X"], nameParts: [] });
    });

    it("SAYS THE TABLET IS UNENROLLED when its token is dead", async () => {
      // Revoked from the dashboard, or the device row is gone. Reporting this
      // as "could not reach the server" sends staff to check the Wi-Fi for a
      // problem no network fixes, and the tablet stays stuck forever.
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 401 }) } as Partial<StationApi>);

      expect(await resolveScan("CARD-X", deps(store, api))).toEqual({ kind: "unenrolled" });
      expect(await store.outboxSize()).toBe(0);
    });

    it("still reports plain failure on a server fault", async () => {
      // A 500 is not a dead token. Re-enrolling would not help, and the
      // tablet should keep its enrolment.
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 500 }) } as Partial<StationApi>);

      expect(await resolveScan("CARD-X", deps(store, api))).toEqual({ kind: "failed" });
    });
  });

  describe("a real magnetic stripe", () => {
    const REAL_SWIPE = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";

    it("MATCHES ON EITHER NUMBER THE STRIPE CARRIES", async () => {
      // Track 2's number is track 1's plus a likely card-issue suffix. Bound
      // under one of them, a swipe must still resolve.
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      const api = fakeApi();

      const outcome = await resolveScan(REAL_SWIPE, deps(store, api));

      expect(outcome.kind).toBe("checked-in");
      expect(api.resolve).not.toHaveBeenCalled();
    });

    it("matches when bound under the longer number instead", async () => {
      const store = await seeded([{ token: "9999990000001238700", netid: "aa1111" }]);

      expect((await resolveScan(REAL_SWIPE, deps(store, fakeApi()))).kind).toBe("checked-in");
    });

    it("CARRIES THE NAME OFF THE CARD INTO THE PROMPT", async () => {
      // 196 people each need binding once on the first day, and the card
      // already says who they are.
      const store = await seeded();
      const api = fakeApi({
        resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      } as Partial<StationApi>);

      const outcome = await resolveScan(REAL_SWIPE, deps(store, api));

      expect(outcome).toEqual({
        kind: "prompt",
        cards: ["9999990000001238700", "999999000000123"],
        nameParts: ["ALICE", "BROWNING"],
      });
    });

    it("caches BOTH numbers once the server identifies the holder", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      await resolveScan(REAL_SWIPE, deps(store, api));

      expect((await store.resolveToken("999999000000123"))?.netid).toBe("aa1111");
      expect((await store.resolveToken("9999990000001238700"))?.netid).toBe("aa1111");
    });

    it("sends every candidate to the server in one call", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      await resolveScan(REAL_SWIPE, deps(store, api));

      expect(api.resolve).toHaveBeenCalledOnce();
      expect(api.resolve).toHaveBeenCalledWith(DEVICE_TOKEN, [
        "9999990000001238700",
        "999999000000123",
      ]);
    });
  });

  describe("the queued swipe", () => {
    it("carries a netID, never the card token", async () => {
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      await resolveScan("CARD-1", deps(store, fakeApi()));

      const [item] = await store.peekOutbox();
      expect(item.kind).toBe("swipe");
      expect(item).toMatchObject({ netid: "aa1111" });
      expect(JSON.stringify(item)).not.toContain("CARD-1");
    });

    it("records the moment of the scan, which the rush histogram reads", async () => {
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      await resolveScan("CARD-1", deps(store, fakeApi()));

      const [item] = await store.peekOutbox();
      expect(item.kind === "swipe" && item.scannedAt).toBe(DURING_LUNCH.toISOString());
    });

    it("records manual entry as such", async () => {
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      await resolveScan("CARD-1", deps(store, fakeApi()), "manual");

      const [item] = await store.peekOutbox();
      expect(item.kind === "swipe" && item.entryMethod).toBe("manual");
    });

    it("queues a SECOND swipe on a repeat scan in the same meal", async () => {
      // The tablet does not deduplicate. The database's primary key does.
      // It is the only thing that can see all three lanes.
      const store = await seeded([{ token: "CARD-1", netid: "aa1111" }]);
      const api = fakeApi();

      const first = await resolveScan("CARD-1", deps(store, api));
      const second = await resolveScan("CARD-1", deps(store, api));

      expect(first.kind).toBe("checked-in");
      expect(second.kind).toBe("checked-in");
      expect(await store.outboxSize()).toBe(2);
    });
  });
});
