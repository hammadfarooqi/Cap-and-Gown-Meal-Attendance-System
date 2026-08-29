import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openStore, type StationStore } from "./store";
import { flushOutbox, startOutboxLoop, __resetFlushGuard } from "./outbox";
import type { StationApi } from "./api";

const DEVICE_TOKEN = "device-token-abc";
const opened: { close(): void }[] = [];

async function open(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  return store;
}

const okResult = <T,>(data: T) =>
  ({ ok: true as const, data, versions: { roster: 1, schedule: 1 } });

function fakeApi(over: Partial<StationApi> = {}): StationApi {
  return {
    // A flush now compares the version stamps its responses carried, which
    // can re-warm the cache. Give that a real answer rather than undefined.
    bootstrap: vi
      .fn()
      .mockResolvedValue(okResult({ people: [], credentials: [], schedule: [], clubs: [] })),
    resolve: vi.fn(),
    bind: vi.fn().mockResolvedValue(okResult({ token: "x", netid: "y" })),
    // Default: the directory could not be asked, so nobody is refused.
    directory: vi.fn().mockResolvedValue({ ok: false, status: null }),
    createGuest: vi.fn(),
    sync: vi.fn().mockResolvedValue(okResult({ accepted: 1, skipped: 0 })),
    ...over,
  } as unknown as StationApi;
}

const swipe = (netid: string) =>
  ({ kind: "swipe" as const, netid, scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" as const });

beforeEach(() => __resetFlushGuard());

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

describe("flushOutbox", () => {
  it("sends queued swipes and removes them once acknowledged", async () => {
    const store = await open();
    const api = fakeApi();
    await store.enqueue(swipe("aa1111"));

    const result = await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(api.sync).toHaveBeenCalledOnce();
    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(await store.outboxSize()).toBe(0);
  });

  it("leaves items queued when the server is unreachable", async () => {
    const store = await open();
    const api = fakeApi({
      sync: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);
    await store.enqueue(swipe("aa1111"));

    const result = await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(result).toEqual({ sent: 0, remaining: 1 });
    expect(await store.outboxSize()).toBe(1);
  });

  it("re-sending after a failure produces no duplicates", async () => {
    const store = await open();
    await store.enqueue(swipe("aa1111"));

    const failing = fakeApi({
      sync: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);
    await flushOutbox({ store, api: failing, deviceToken: DEVICE_TOKEN });

    const working = fakeApi();
    await flushOutbox({ store, api: working, deviceToken: DEVICE_TOKEN });

    // Exactly one swipe was ever handed to the server on the successful pass.
    const sent = (working.sync as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sent).toHaveLength(1);
    expect(await store.outboxSize()).toBe(0);
  });

  it("sends bindings as well as swipes", async () => {
    const store = await open();
    const api = fakeApi();
    await store.enqueue({ kind: "binding", token: "CARD-9", netid: "aa1111" });
    await store.enqueue(swipe("aa1111"));

    await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(api.bind).toHaveBeenCalledWith(DEVICE_TOKEN, "CARD-9", "aa1111");
    expect(api.sync).toHaveBeenCalledOnce();
    expect(await store.outboxSize()).toBe(0);
  });

  it("performs no network call at all when the outbox is empty", async () => {
    const store = await open();
    const api = fakeApi();

    const result = await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(api.sync).not.toHaveBeenCalled();
    expect(api.bind).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, remaining: 0 });
  });

  it("drops a binding the server refused with 409 rather than retrying forever", async () => {
    // The server kept its own binding. Retrying is a poison pill in the queue.
    const store = await open();
    const api = fakeApi({
      bind: vi.fn().mockResolvedValue({ ok: false, status: 409 }),
    } as Partial<StationApi>);
    await store.enqueue({ kind: "binding", token: "CARD-9", netid: "aa1111" });

    await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(await store.outboxSize()).toBe(0);
  });

  it("keeps a binding queued when the network is down", async () => {
    const store = await open();
    const api = fakeApi({
      bind: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);
    await store.enqueue({ kind: "binding", token: "CARD-9", netid: "aa1111" });

    await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(await store.outboxSize()).toBe(1);
  });

  it("still sends swipes when a binding fails", async () => {
    const store = await open();
    const api = fakeApi({
      bind: vi.fn().mockResolvedValue({ ok: false, status: null }),
    } as Partial<StationApi>);
    await store.enqueue({ kind: "binding", token: "CARD-9", netid: "aa1111" });
    await store.enqueue(swipe("aa1111"));

    await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });

    expect(api.sync).toHaveBeenCalledOnce();
    expect(await store.outboxSize()).toBe(1); // only the binding remains
  });

  it("does not send the same item twice when two flushes overlap", async () => {
    // A scan triggers an immediate flush while the loop is mid-tick.
    const store = await open();
    await store.enqueue(swipe("aa1111"));

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    const api = fakeApi({
      sync: vi.fn().mockImplementation(async () => {
        await gate;
        return okResult({ accepted: 1, skipped: 0 });
      }),
    } as Partial<StationApi>);

    const first = flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });
    const second = flushOutbox({ store, api, deviceToken: DEVICE_TOKEN });
    release();
    await Promise.all([first, second]);

    expect(api.sync).toHaveBeenCalledOnce();
  });
});

describe("startOutboxLoop", () => {
  it("flushes on a timer and stops when told to", async () => {
    // Real timers with a short interval. Fake timers cannot drive this:
    // fake-indexeddb resolves on its own real async scheduling, so an
    // advanced interval fires the flush but the database calls inside it
    // never complete.
    const store = await open();
    const api = fakeApi();
    await store.enqueue(swipe("aa1111"));

    const stop = startOutboxLoop({ store, api, deviceToken: DEVICE_TOKEN }, 10);

    await vi.waitFor(() => expect(api.sync).toHaveBeenCalledOnce(), { timeout: 2000 });

    stop();
    const callsWhenStopped = (api.sync as ReturnType<typeof vi.fn>).mock.calls.length;

    await store.enqueue(swipe("bb2222"));
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect((api.sync as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsWhenStopped);
    expect(await store.outboxSize()).toBe(1);
  });

  describe("learning that the roster moved", () => {
    it("COMPARES THE VERSION STAMPS a response carried", async () => {
      // The whole no-polling design rests on this. It was written, tested in
      // isolation, and never called from anywhere — so a running tablet only
      // refreshed on page load, and a card bound on another lane stayed
      // invisible to it for the rest of service.
      const store = await open();
      await store.enqueue({
        kind: "swipe", netid: "aa1111",
        scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan",
      });
      const refresh = vi.fn().mockResolvedValue(true);

      await flushOutbox({ store, api: fakeApi(), deviceToken: DEVICE_TOKEN, refresh });

      expect(refresh).toHaveBeenCalledOnce();
      expect(refresh.mock.calls[0][1]).toEqual({ roster: 1, schedule: 1 });
    });

    it("does not bother when nothing was sent", async () => {
      const store = await open();
      const refresh = vi.fn();

      await flushOutbox({ store, api: fakeApi(), deviceToken: DEVICE_TOKEN, refresh });

      expect(refresh).not.toHaveBeenCalled();
    });

    it("DROPS A BINDING LEFT BY AN OLDER BUILD instead of retrying it forever", async () => {
      // Those carried `tokens: string[]`, not `token`. Sending undefined
      // earns a 400, which is not a status the queue drops, so the item would
      // be retried every few seconds for the rest of the tablet's life.
      const store = await open();
      await store.enqueue({ kind: "binding", netid: "aa1111" } as never);
      const api = fakeApi();

      await flushOutbox({ store, api, deviceToken: DEVICE_TOKEN, refresh: vi.fn() });

      expect(api.bind).not.toHaveBeenCalled();
      expect(await store.outboxSize()).toBe(0);
    });
  });
});
