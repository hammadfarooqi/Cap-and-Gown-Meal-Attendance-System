import { describe, it, expect, afterEach } from "vitest";
import { openStore, type CachedPerson } from "./store";
import type { MealWindow } from "@/lib/meals/types";

const person = (netid: string, over: Partial<CachedPerson> = {}): CachedPerson => ({
  netid,
  fullName: `Person ${netid}`,
  isMember: true,
  homeClub: "Cap & Gown",
  photoPath: `${netid}.webp`,
  ...over,
});

const SCHEDULE: MealWindow[] = [
  { dayOfWeek: 3, periodName: "lunch", startTime: "11:30:00", endTime: "13:30:00", graceMinutes: 15 },
];

// Every open connection has to be closed before the database can be deleted.
// A live handle makes deleteDatabase block forever, which surfaces as every
// test after the first one timing out rather than as an obvious error.
const opened: { close(): void }[] = [];

async function open() {
  const store = await openStore();
  opened.push(store);
  return store;
}

afterEach(async () => {
  for (const store of opened) store.close();
  opened.length = 0;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("cap-station");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe("the station store", () => {
  it("resolves a token to the person behind it", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "CARD-1", netid: "aa1111" }],
      schedule: SCHEDULE,
      clubs: ["Cap & Gown", "Cottage", "None"],
      versions: { roster: 1, schedule: 1 },
    });

    expect((await store.resolveToken("CARD-1"))?.netid).toBe("aa1111");
  });

  it("returns null for a token it has never seen", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [], credentials: [], schedule: [], clubs: [], versions: { roster: 1, schedule: 1 },
    });

    expect(await store.resolveToken("NOPE")).toBeNull();
  });

  it("resolves a token added after bootstrap", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111")], credentials: [],
      schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 1, schedule: 1 },
    });

    await store.addCredential("NEW-CARD", "aa1111");

    expect((await store.resolveToken("NEW-CARD"))?.fullName).toBe("Person aa1111");
  });

  it("resolves two different tokens to the same person", async () => {
    // A replacement card adds a credential rather than replacing one.
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "OLD", netid: "aa1111" }],
      schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 1, schedule: 1 },
    });
    await store.addCredential("NEW", "aa1111");

    expect((await store.resolveToken("OLD"))?.netid).toBe("aa1111");
    expect((await store.resolveToken("NEW"))?.netid).toBe("aa1111");
  });

  it("survives being reopened, so a tablet reboot loses nothing", async () => {
    const first = await open();
    await first.putBootstrap({
      people: [person("aa1111")],
      credentials: [{ token: "CARD-1", netid: "aa1111" }],
      schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 4, schedule: 2 },
    });

    const second = await open();
    expect((await second.resolveToken("CARD-1"))?.netid).toBe("aa1111");
    expect(await second.getVersions()).toEqual({ roster: 4, schedule: 2 });
  });

  it("replaces the roster on re-bootstrap rather than merging it", async () => {
    // A departed member must actually disappear from the picker.
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111"), person("bb2222")],
      credentials: [], schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 1, schedule: 1 },
    });
    await store.putBootstrap({
      people: [person("aa1111")],
      credentials: [], schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 2, schedule: 1 },
    });

    expect((await store.allMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });

  it("lists members with no bound card first, for the picker", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111"), person("bb2222"), person("cc3333")],
      credentials: [{ token: "CARD-B", netid: "bb2222" }],
      schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 1, schedule: 1 },
    });

    const unbound = (await store.unboundMembers()).map((p) => p.netid);
    expect(unbound).toContain("aa1111");
    expect(unbound).toContain("cc3333");
    expect(unbound).not.toContain("bb2222");
  });

  it("excludes non-members from the member picker", async () => {
    const store = await open();
    await store.putBootstrap({
      people: [person("aa1111"), person("gg9999", { isMember: false, homeClub: "Cottage" })],
      credentials: [], schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 1, schedule: 1 },
    });

    expect((await store.unboundMembers()).map((p) => p.netid)).toEqual(["aa1111"]);
  });

  it("stores and returns a photo blob", async () => {
    const store = await open();
    const blob = new Blob(["fake-image-bytes"], { type: "image/webp" });

    await store.putPhoto("aa1111.webp", blob);

    expect(await store.hasPhoto("aa1111.webp")).toBe(true);
    expect(await (await store.getPhoto("aa1111.webp"))!.text()).toBe("fake-image-bytes");
  });

  it("reports a photo it does not have", async () => {
    const store = await open();
    expect(await store.hasPhoto("missing.webp")).toBe(false);
  });

  it("keeps photos across a re-bootstrap", async () => {
    // Re-bootstrap happens whenever the roster version moves. Dropping ~12MB
    // of headshots because a name was corrected would be a bad trade.
    const store = await open();
    await store.putPhoto("aa1111.webp", new Blob(["bytes"]));
    await store.putBootstrap({
      people: [person("aa1111")], credentials: [],
      schedule: SCHEDULE, clubs: ["Cap & Gown", "Cottage", "None"], versions: { roster: 9, schedule: 1 },
    });

    expect(await store.hasPhoto("aa1111.webp")).toBe(true);
  });

  it("queues outbox items in order and hands them back with ids", async () => {
    const store = await open();
    await store.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.enqueue({ kind: "binding", tokens: ["CARD-9"], netid: "aa1111" });

    const items = await store.peekOutbox();
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("swipe");
    expect(items[1].kind).toBe("binding");
    expect(items.every((i) => typeof i.id === "number")).toBe(true);
  });

  it("removes only the items that were acknowledged", async () => {
    const store = await open();
    await store.enqueue({ kind: "swipe", netid: "a", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.enqueue({ kind: "swipe", netid: "b", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });

    const [first] = await store.peekOutbox();
    await store.removeFromOutbox([first.id]);

    const left = await store.peekOutbox();
    expect(left).toHaveLength(1);
    expect(left[0].kind === "swipe" && left[0].netid).toBe("b");
  });

  it("keeps the outbox across a reopen, so a reboot mid-rush loses no scans", async () => {
    const first = await open();
    await first.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });

    const second = await open();
    expect(await second.outboxSize()).toBe(1);
  });

  it("does not clear the outbox on re-bootstrap", async () => {
    const store = await open();
    await store.enqueue({ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" });
    await store.putBootstrap({
      people: [], credentials: [], schedule: [], clubs: [], versions: { roster: 2, schedule: 2 },
    });

    expect(await store.outboxSize()).toBe(1);
  });
});
