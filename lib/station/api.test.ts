import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ATTEMPT_TIMEOUT_MS, MAX_ATTEMPTS } from "./api";

const FAST = { attemptTimeoutMs: 20, maxAttempts: 3 };
const DEVICE_TOKEN = "device-token-abc";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const envelope = (data: unknown) => ({ data, versions: { roster: 3, schedule: 1 } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("the station API client", () => {
  it("sends the device token as a Bearer header", async () => {
    fetchMock.mockResolvedValue(jsonResponse(envelope({ people: [] })));

    await api.bootstrap(DEVICE_TOKEN, FAST);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
  });

  it("unwraps the envelope so callers never see it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(envelope({ netid: "aa1111" })));

    const result = await api.resolve(DEVICE_TOKEN, "CARD-1", FAST);

    expect(result).toEqual({
      ok: true,
      data: { netid: "aa1111" },
      versions: { roster: 3, schedule: 1 },
    });
  });

  it("reports a 404 from resolve without retrying", async () => {
    // 404 means "unknown card", which is an answer the caller branches on.
    fetchMock.mockResolvedValue(jsonResponse({ error: "unknown token" }, 404));

    const result = await api.resolve(DEVICE_TOKEN, "CARD-1", FAST);

    expect(result).toEqual({ ok: false, status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a 401 without retrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    expect(await api.bootstrap(DEVICE_TOKEN, FAST)).toEqual({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a 409 from bind without retrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "already bound" }, 409));

    expect(await api.bind(DEVICE_TOKEN, "CARD-1", "aa1111", FAST))
      .toEqual({ ok: false, status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure up to the attempt limit, then gives up", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await api.resolve(DEVICE_TOKEN, "CARD-1", FAST);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ ok: false, status: null });
  });

  it("retries a 500 but not a 400", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    await api.sync(DEVICE_TOKEN, [], FAST);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    await api.sync(DEVICE_TOKEN, [], FAST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("succeeds on a retry after a transient failure", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(envelope({ netid: "aa1111" })));

    const result = await api.resolve(DEVICE_TOKEN, "CARD-1", FAST);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports status null when the network never answered", async () => {
    // The caller distinguishes "the server refused" from "there is no server".
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await api.bootstrap(DEVICE_TOKEN, FAST)).toEqual({ ok: false, status: null });
  });

  it("aborts a hanging request instead of waiting forever", async () => {
    // The failure mode that would freeze a lane: a server that accepts the
    // connection and never replies.
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );

    const started = Date.now();
    const result = await api.resolve(DEVICE_TOKEN, "CARD-1", FAST);

    expect(result).toEqual({ ok: false, status: null });
    expect(Date.now() - started).toBeLessThan(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("holds to the three-second budget in its defaults", async () => {
    // The behaviour above is verified with small numbers for speed. This
    // pins the real values that ship.
    expect(ATTEMPT_TIMEOUT_MS * MAX_ATTEMPTS).toBeLessThanOrEqual(3000);
  });

  it("sends only swipes to /api/sync, not bindings", async () => {
    fetchMock.mockResolvedValue(jsonResponse(envelope({ accepted: 1, skipped: 0 })));

    await api.sync(
      DEVICE_TOKEN,
      [
        { kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" },
        { kind: "binding", token: "CARD-9", netid: "aa1111" },
      ],
      FAST,
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.swipes).toHaveLength(1);
    expect(body.swipes[0].netid).toBe("aa1111");
  });

  it("sends a swipe's netid rather than a card token", async () => {
    // The whole reason the outbox has no ordering constraints.
    fetchMock.mockResolvedValue(jsonResponse(envelope({ accepted: 1, skipped: 0 })));

    await api.sync(
      DEVICE_TOKEN,
      [{ kind: "swipe", netid: "aa1111", scannedAt: "2026-09-02T16:00:00Z", entryMethod: "scan" }],
      FAST,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body.swipes[0]).sort()).toEqual(["entryMethod", "netid", "scannedAt"]);
  });
});
