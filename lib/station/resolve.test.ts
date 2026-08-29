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

/** Shares a full name with TWIN_B, the way two real members do. */
const TWIN_A: CachedPerson = {
  netid: "rh1000", fullName: "Robin Hale", isMember: true, homeClub: "Cap & Gown", photoPath: null,
};
const TWIN_B: CachedPerson = {
  netid: "rh1001", fullName: "Robin Hale", isMember: true, homeClub: "Cap & Gown", photoPath: null,
};
/** The name the synthetic test card is printed with. */
const ON_THE_CARD: CachedPerson = {
  netid: "ab1234", fullName: "Alice Browning", isMember: true, homeClub: "Cap & Gown", photoPath: null,
};
/** A guest entered by hand on an earlier night: a row, but no card. */
const KNOWN_GUEST: CachedPerson = {
  netid: "gg9999", fullName: "Guest Person", isMember: false, homeClub: "Cottage", photoPath: null,
};

/** A swipe from a card printed ALICE/BROWNING. */
const CARD = "%999999000000123=ALICE/BROWNING?;9999990000001238700=?";
/** A card whose printed name matches nobody on the roster. */
const STRANGER_CARD = "%999999000000456=JOHN/SMITH?;9999990000004568700=?";
/** A card printed with the name two members share. */
const TWIN_CARD = "%999999000000789=ROBIN/HALE?;9999990000007898700=?";

const opened: { close(): void }[] = [];

async function seeded(
  credentials: { token: string; netid: string }[] = [],
  people: CachedPerson[] = [MEMBER],
): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  await store.putBootstrap({
    people,
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
    // Default: the directory could not be asked, so nobody is refused.
    directory: vi.fn().mockResolvedValue({ ok: false, status: null }),
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
    const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
    const api = fakeApi();

    const outcome = await resolveScan(CARD, deps(store, api, BETWEEN_MEALS));

    expect(outcome).toEqual({ kind: "no-meal" });
    expect(await store.outboxSize()).toBe(0);
    expect(api.resolve).not.toHaveBeenCalled();
  });

  describe("case 1 — the token is cached", () => {
    it("checks the person in with no network call at all", async () => {
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      const api = fakeApi();

      const outcome = await resolveScan(CARD, deps(store, api));

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
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      const api = fakeApi({
        resolve: vi.fn().mockImplementation(() => new Promise(() => {})),
      } as Partial<StationApi>);

      const outcome = await resolveScan(CARD, deps(store, api));

      expect(outcome.kind).toBe("checked-in");
    });
  });

  describe("case 2 — not cached, the server knows the card", () => {
    it("checks them in and caches the answer", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      const outcome = await resolveScan(CARD, deps(store, api));

      expect(outcome.kind).toBe("checked-in");
      expect((await store.resolveToken("999999000000123"))?.netid).toBe("aa1111");
      expect(await store.outboxSize()).toBe(1);
    });

    it("makes the second scan of that card a cache hit", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      await resolveScan(CARD, deps(store, api));
      await resolveScan(CARD, deps(store, api));

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

      await resolveScan(CARD, deps(store, api));

      expect((await store.resolveToken("999999000000123"))?.fullName).toBe("Guest");
    });
  });

  describe("case 3 — not cached, the server has never seen the card", () => {
    it("OFFERS THE ONE PERSON THE CARD NAMES", async () => {
      // The path 194 of 196 members take on their first swipe.
      const store = await seeded([], [MEMBER, ON_THE_CARD]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      const outcome = await resolveScan(CARD, deps(store, api));

      expect(outcome.kind).toBe("candidates");
      expect(outcome).toMatchObject({ card: "999999000000123" });
      expect((outcome as { candidates: CachedPerson[] }).candidates.map((p) => p.netid))
        .toEqual(["ab1234"]);
      expect(await store.outboxSize()).toBe(0);
    });

    it("OFFERS BOTH PEOPLE WHO SHARE A NAME rather than choosing one", async () => {
      const store = await seeded([], [TWIN_A, TWIN_B]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      const outcome = await resolveScan(TWIN_CARD, deps(store, api));

      expect((outcome as { candidates: CachedPerson[] }).candidates.map((p) => p.netid))
        .toEqual(["rh1000", "rh1001"]);
    });

    it("EXCLUDES SOMEBODY WHO ALREADY HAS A CARD", async () => {
      // Once the first of the two is bound, the second swipe offers only the
      // other one. Spec case 6.
      const store = await seeded([{ token: "OTHER-CARD", netid: "rh1000" }], [TWIN_A, TWIN_B]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      const outcome = await resolveScan(TWIN_CARD, deps(store, api));

      expect((outcome as { candidates: CachedPerson[] }).candidates.map((p) => p.netid))
        .toEqual(["rh1001"]);
    });

    it("OFFERS AN UNBOUND GUEST, not only members", async () => {
      const store = await seeded([], [KNOWN_GUEST]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      const outcome = await resolveScan(
        "%999999000000999=GUEST/PERSON?;9999990000009998700=?",
        deps(store, api),
      );

      expect((outcome as { candidates: CachedPerson[] }).candidates.map((p) => p.netid))
        .toEqual(["gg9999"]);
    });

    it("offers nobody when the card names nobody on the roster", async () => {
      const store = await seeded([], [MEMBER, ON_THE_CARD]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      const outcome = await resolveScan(STRANGER_CARD, deps(store, api));

      expect(outcome.kind).toBe("candidates");
      expect((outcome as { candidates: CachedPerson[] }).candidates).toEqual([]);
    });
  });

  describe("case 4 — not cached, the server does not answer", () => {
    it("STILL OFFERS CANDIDATES, so a member is never stopped by dead Wi-Fi", async () => {
      // Spec A6. The name match is local, so an unreachable server costs
      // nothing on the member path.
      const store = await seeded([], [MEMBER, ON_THE_CARD]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: null }) } as Partial<StationApi>);

      const outcome = await resolveScan(CARD, deps(store, api));

      expect(outcome.kind).toBe("candidates");
      expect((outcome as { candidates: CachedPerson[] }).candidates.map((p) => p.netid))
        .toEqual(["ab1234"]);
    });

    it("SAYS THE TABLET IS UNENROLLED when its token is dead", async () => {
      // Revoked from the dashboard, or the device row is gone. Reporting this
      // as "could not reach the server" sends staff to check the Wi-Fi for a
      // problem no network fixes, and the tablet stays stuck forever.
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 401 }) } as Partial<StationApi>);

      expect(await resolveScan(CARD, deps(store, api))).toEqual({ kind: "unenrolled" });
      expect(await store.outboxSize()).toBe(0);
    });

    it("still reports plain failure on a server fault", async () => {
      // A 500 is not a dead token. Re-enrolling would not help, and the
      // tablet should keep its enrolment.
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 500 }) } as Partial<StationApi>);

      expect(await resolveScan(CARD, deps(store, api))).toEqual({ kind: "failed" });
    });
  });

  describe("a real magnetic stripe", () => {
    const REAL_SWIPE = CARD;

    it("MATCHES ON EITHER NUMBER THE STRIPE CARRIES", async () => {
      // Track 2's number is track 1's plus a likely card-issue suffix. Bound
      // under one of them, a swipe must still resolve.
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      const api = fakeApi();

      const outcome = await resolveScan(REAL_SWIPE, deps(store, api));

      expect(outcome.kind).toBe("checked-in");
      expect(api.resolve).not.toHaveBeenCalled();
    });

    it("CARRIES THE NAME OFF THE CARD INTO THE PROMPT", async () => {
      // 196 people each need binding once on the first day, and the card
      // already says who they are.
      const store = await seeded();
      const api = fakeApi({
        resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      } as Partial<StationApi>);

      const outcome = await resolveScan(REAL_SWIPE, deps(store, api));

      expect(outcome.kind).toBe("candidates");
      expect(outcome).toMatchObject({ card: "999999000000123" });
    });

    it("CACHES THE BASE ONLY, so one card is one row", async () => {
      // Inverted from the original design, which cached both numbers. Two
      // rows for one card is now refused by the database, so caching the
      // 19-digit number would put the tablet out of step with the server.
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue(okResult(MEMBER)) } as Partial<StationApi>);

      await resolveScan(REAL_SWIPE, deps(store, api));

      expect((await store.resolveToken("999999000000123"))?.netid).toBe("aa1111");
      expect(await store.resolveToken("9999990000001238700")).toBeNull();
    });

    it("asks the server about the base number, once", async () => {
      const store = await seeded();
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      await resolveScan(REAL_SWIPE, deps(store, api));

      expect(api.resolve).toHaveBeenCalledOnce();
      expect(api.resolve).toHaveBeenCalledWith(DEVICE_TOKEN, "999999000000123");
    });
  });

  describe("a typed netID", () => {
    it("CHECKS IN DIRECTLY, with no tile and no binding", async () => {
      // A typed netID is the identity itself. There is no card to bind, and
      // asking "is this you?" would confirm what was just typed.
      const store = await seeded([], [MEMBER]);
      const api = fakeApi();

      const outcome = await resolveScan("aa1111", deps(store, api), "manual");

      expect(outcome.kind).toBe("checked-in");
      expect(api.resolve).not.toHaveBeenCalled();
      expect(await store.outboxSize()).toBe(1);
    });

    it("CHECKS IN SOMEBODY WHO ALREADY HAS A CARD", async () => {
      // Matching only unbound people, the way the card path does, would send
      // a bound member to the guest form. This is why it searches everyone.
      const store = await seeded([{ token: "THEIR-CARD", netid: "aa1111" }], [MEMBER]);

      const outcome = await resolveScan("aa1111", deps(store, fakeApi()), "manual");

      expect(outcome.kind).toBe("checked-in");
    });

    it("checks in a guest the tablet already knows", async () => {
      const store = await seeded([], [KNOWN_GUEST]);

      const outcome = await resolveScan("gg9999", deps(store, fakeApi()), "manual");

      expect(outcome.kind).toBe("checked-in");
    });

    it("BINDS NOTHING, because there is no card in a typed netID", async () => {
      const store = await seeded([], [MEMBER]);

      await resolveScan("aa1111", deps(store, fakeApi()), "manual");

      const kinds = (await store.peekOutbox()).map((i) => i.kind);
      expect(kinds).toEqual(["swipe"]);
    });

    it("OFFERS NO CARD TO BIND, because a typed netID is not a credential", async () => {
      // It used to carry the typed string through as the card. The guest form
      // then bound "zz9999" into credentials as though it were a card number,
      // which quietly makes that person look bound: their real card would
      // later find no tile and send them to an officer.
      const store = await seeded([], [MEMBER]);

      const outcome = await resolveScan("zz9999", deps(store, fakeApi()), "manual");

      expect(outcome).toMatchObject({ kind: "candidates", card: null });
    });

    it("carries the entry method, so a binding is not recorded as typed", async () => {
      const store = await seeded([], [MEMBER, ON_THE_CARD]);
      const api = fakeApi({ resolve: vi.fn().mockResolvedValue({ ok: false, status: 404 }) } as Partial<StationApi>);

      expect(await resolveScan(CARD, deps(store, api))).toMatchObject({ entryMethod: "scan" });
      expect(await resolveScan("zz9999", deps(store, api), "manual"))
        .toMatchObject({ entryMethod: "manual" });
    });

    it("REFUSES A TYPED VALUE THAT IS NOT A NETID", async () => {
      // The box blocks this, but the burst detector can also hand over a
      // short non-card string, and that must not reach the guest route.
      const store = await seeded([], [MEMBER]);

      expect(await resolveScan("zz99", deps(store, fakeApi()), "manual"))
        .toEqual({ kind: "not-a-netid" });
    });

    it("offers nobody for a netID it has never seen", async () => {
      const store = await seeded([], [MEMBER]);

      const outcome = await resolveScan("zz9999", deps(store, fakeApi()), "manual");

      expect(outcome.kind).toBe("candidates");
      expect((outcome as { candidates: CachedPerson[] }).candidates).toEqual([]);
    });
  });

  describe("the queued swipe", () => {
    it("carries a netID, never the card token", async () => {
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      await resolveScan(CARD, deps(store, fakeApi()));

      const [item] = await store.peekOutbox();
      expect(item.kind).toBe("swipe");
      expect(item).toMatchObject({ netid: "aa1111" });
      expect(JSON.stringify(item)).not.toContain("999999000000123");
    });

    it("records the moment of the scan, which the rush histogram reads", async () => {
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      await resolveScan(CARD, deps(store, fakeApi()));

      const [item] = await store.peekOutbox();
      expect(item.kind === "swipe" && item.scannedAt).toBe(DURING_LUNCH.toISOString());
    });

    it("records manual entry as such", async () => {
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      // A card read on the lane that has no scanner: entry method is what
      // the operator did, not what the input looked like.
      await resolveScan(CARD, deps(store, fakeApi()), "manual");

      const [item] = await store.peekOutbox();
      expect(item.kind === "swipe" && item.entryMethod).toBe("manual");
    });

    it("queues a SECOND swipe on a repeat scan in the same meal", async () => {
      // The tablet does not deduplicate. The database's primary key does.
      // It is the only thing that can see all three lanes.
      const store = await seeded([{ token: "999999000000123", netid: "aa1111" }]);
      const api = fakeApi();

      const first = await resolveScan(CARD, deps(store, api));
      const second = await resolveScan(CARD, deps(store, api));

      expect(first.kind).toBe("checked-in");
      expect(second.kind).toBe("checked-in");
      expect(await store.outboxSize()).toBe(2);
    });
  });
});
