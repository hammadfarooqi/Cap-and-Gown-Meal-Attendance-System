import { describe, it, expect, vi, afterEach } from "vitest";
import { openStore, type StationStore, type CachedPerson } from "./store";
import { bindMember, createGuest } from "./prompt";
import type { StationApi } from "./api";
import type { MealWindow } from "@/lib/meals/types";

const DEVICE_TOKEN = "device-token-abc";
const DURING_LUNCH = new Date("2026-09-02T16:00:00.000Z");

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

const MEMBER: CachedPerson = {
  netid: "aa1111", fullName: "Cached Member", isMember: true,
  homeClub: "Cap & Gown", photoPath: "aa1111.webp",
};

const GUEST: CachedPerson = {
  netid: "gg9999", fullName: "gg9999", isMember: false,
  homeClub: "Cottage", photoPath: null,
};

const opened: { close(): void }[] = [];

async function seeded(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  await store.putBootstrap({
    people: [MEMBER], credentials: [], schedule: SCHEDULE,
    clubs: ["Cap & Gown", "Cottage", "None"],
    versions: { roster: 1, schedule: 1 },
  });
  return store;
}

const okResult = <T,>(data: T) =>
  ({ ok: true as const, data, versions: { roster: 1, schedule: 1 } });

function fakeApi(over: Partial<StationApi> = {}): StationApi {
  return {
    bootstrap: vi.fn(), resolve: vi.fn(), bind: vi.fn(),
    createGuest: vi.fn().mockResolvedValue(okResult(GUEST)),
    sync: vi.fn(),
    ...over,
  } as unknown as StationApi;
}

const deps = (store: StationStore, api: StationApi) =>
  ({ store, api, deviceToken: DEVICE_TOKEN, now: () => DURING_LUNCH });

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

describe("bindMember", () => {
  it("checks the member in and caches the card locally", async () => {
    const store = await seeded();
    const outcome = await bindMember("CARD-NEW", "aa1111", deps(store, fakeApi()));

    expect(outcome).toEqual({ kind: "checked-in", person: MEMBER, mealPeriod: "lunch" });
    expect((await store.resolveToken("CARD-NEW"))?.netid).toBe("aa1111");
  });

  it("WORKS WITH NO NETWORK AT ALL — the reason an outage never stops a member", async () => {
    const store = await seeded();
    const api = fakeApi({
      bind: vi.fn().mockRejectedValue(new Error("offline")),
      createGuest: vi.fn().mockRejectedValue(new Error("offline")),
    } as Partial<StationApi>);

    const outcome = await bindMember("CARD-NEW", "aa1111", deps(store, api));

    expect(outcome.kind).toBe("checked-in");
    expect(api.bind).not.toHaveBeenCalled();
  });

  it("queues both the binding and the swipe for later", async () => {
    const store = await seeded();
    await bindMember("CARD-NEW", "aa1111", deps(store, fakeApi()));

    const kinds = (await store.peekOutbox()).map((i) => i.kind);
    expect(kinds).toContain("binding");
    expect(kinds).toContain("swipe");
  });

  it("makes the next scan of that card a plain cache hit", async () => {
    const store = await seeded();
    await bindMember("CARD-NEW", "aa1111", deps(store, fakeApi()));

    expect((await store.resolveToken("CARD-NEW"))?.fullName).toBe("Cached Member");
  });

  it("refuses a netid that is not in the cached roster", async () => {
    const store = await seeded();
    const outcome = await bindMember("CARD-NEW", "ghost999", deps(store, fakeApi()));

    expect(outcome).toEqual({ kind: "failed" });
    expect(await store.outboxSize()).toBe(0);
  });

  it("reports no meal outside every window", async () => {
    const store = await seeded();
    const outcome = await bindMember("CARD-NEW", "aa1111", {
      ...deps(store, fakeApi()),
      now: () => new Date("2026-09-02T19:00:00.000Z"),
    });

    expect(outcome).toEqual({ kind: "no-meal" });
    expect(await store.outboxSize()).toBe(0);
  });
});

describe("createGuest", () => {
  it("checks the guest in and caches them", async () => {
    const store = await seeded();
    const api = fakeApi();

    const outcome = await createGuest("CARD-G", "gg9999", "Cottage", deps(store, api));

    expect(outcome).toEqual({ kind: "checked-in", person: GUEST, mealPeriod: "lunch" });
    expect(api.createGuest).toHaveBeenCalledWith(DEVICE_TOKEN, "gg9999", "Cottage", "CARD-G");
    expect((await store.resolveToken("CARD-G"))?.netid).toBe("gg9999");
    expect(await store.outboxSize()).toBe(1);
  });

  it("IS ABANDONED WHEN THE SERVER IS UNREACHABLE — an accepted, deliberate loss", async () => {
    // Spec A6. This is the one lossy path in the system. It needs a brand-new
    // guest AND an outage at the same moment. Do not "fix" this by queuing:
    // the person does not exist yet and their netID has not been validated.
    const store = await seeded();
    const api = fakeApi({
      createGuest: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);

    const outcome = await createGuest("CARD-G", "gg9999", "Cottage", deps(store, api));

    expect(outcome).toEqual({ kind: "failed" });
    expect(await store.outboxSize()).toBe(0);
  });

  it("leaves nothing half-created locally when it fails", async () => {
    const store = await seeded();
    const api = fakeApi({
      createGuest: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);

    await createGuest("CARD-G", "gg9999", "Cottage", deps(store, api));

    expect(await store.resolveToken("CARD-G")).toBeNull();
    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });

  it("SAYS TO SEE AN OFFICER when that netID already has a card", async () => {
    // The one place the officer message comes from. Reporting this as a plain
    // failure would send staff to check the Wi-Fi for something the network
    // cannot fix, and the person would keep retrying.
    const store = await seeded();
    const api = fakeApi({
      createGuest: vi.fn().mockResolvedValue({ ok: false, status: 409 }),
    } as Partial<StationApi>);

    const outcome = await createGuest("CARD-G", "gg9999", "Cottage", deps(store, api));

    expect(outcome).toEqual({ kind: "already-bound", netid: "gg9999" });
    expect(await store.resolveToken("CARD-G")).toBeNull();
    expect(await store.outboxSize()).toBe(0);
  });

  it("fails on a rejected netid rather than inventing a person", async () => {
    const store = await seeded();
    const api = fakeApi({
      createGuest: vi.fn().mockResolvedValue({ ok: false, status: 400 }),
    } as Partial<StationApi>);

    expect(await createGuest("CARD-G", "bad netid", "Cottage", deps(store, api)))
      .toEqual({ kind: "failed" });
  });

  it("works without a card, for a guest entered by hand", async () => {
    const store = await seeded();
    const outcome = await createGuest(null, "gg9999", "Cottage", deps(store, fakeApi()));

    expect(outcome.kind).toBe("checked-in");
    expect(await store.outboxSize()).toBe(1);
  });
});
