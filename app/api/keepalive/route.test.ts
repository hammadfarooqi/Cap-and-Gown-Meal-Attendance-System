import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/db/client", () => ({ serviceClient: () => ({ from }) }));

const { GET } = await import("./route");

/** Stand-in for the chain this route uses: update → eq → select → single. */
const writeChain = (result: { data?: unknown; error: { message: string } | null }) => {
  const update = vi.fn((payload: { last_ping: string }) => {
    void payload;
    return { eq: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }) };
  });
  return { update, handle: { update } };
};

beforeEach(() => from.mockReset());

describe("GET /api/keepalive", () => {
  it("WRITES rather than reads, which is the whole point", async () => {
    // A SELECT here is what let the project pause on 2026-08-25: it ran on
    // schedule, returned ok every time, and did not reset Supabase's
    // inactivity timer. Only a write does.
    const chain = writeChain({ data: { last_ping: "2026-08-26T03:00:00Z" }, error: null });
    from.mockReturnValue(chain.handle);

    await GET();

    expect(from).toHaveBeenCalledWith("heartbeat");
    expect(chain.update).toHaveBeenCalledOnce();
  });

  it("stamps the row with a fresh time", async () => {
    const chain = writeChain({ data: { last_ping: "2026-08-26T03:00:00Z" }, error: null });
    from.mockReturnValue(chain.handle);

    await GET();

    const [payload] = chain.update.mock.calls[0];
    expect(new Date(payload.last_ping).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it("reports the time the write landed", async () => {
    from.mockReturnValue(writeChain({ data: { last_ping: "2026-08-26T03:00:00Z" }, error: null }).handle);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true, at: "2026-08-26T03:00:00Z" });
  });

  it("fails loudly when the write fails, so the scheduled job goes red", async () => {
    from.mockReturnValue(writeChain({ error: { message: "connection refused" } }).handle);

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("connection refused");
  });
});
