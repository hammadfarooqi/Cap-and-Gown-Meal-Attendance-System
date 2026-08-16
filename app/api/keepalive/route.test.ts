import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/db/client", () => ({ serviceClient: () => ({ from }) }));

const { GET } = await import("./route");

/** Minimal stand-in for the part of the query builder this route uses. */
const query = (result: { error: { message: string } | null }) => ({
  select: () => ({ limit: () => Promise.resolve(result) }),
});

beforeEach(() => from.mockReset());

describe("GET /api/keepalive", () => {
  it("queries a real table rather than returning a constant", async () => {
    // The point of this endpoint is the query, not the response. A ping that
    // does not touch Postgres would not reset Supabase's inactivity timer,
    // and the project would pause anyway — silently, over a break, with
    // nobody watching. This endpoint looks pointless enough that someone may
    // later "simplify" it to `return { ok: true }`. This test stops that.
    from.mockReturnValue(query({ error: null }));

    await GET();

    expect(from).toHaveBeenCalledWith("versions");
  });

  it("reports ok with a parseable timestamp", async () => {
    from.mockReturnValue(query({ error: null }));

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(new Date(body.at).getTime()).not.toBeNaN();
  });

  it("fails loudly when the query fails, so the scheduled job goes red", async () => {
    from.mockReturnValue(query({ error: { message: "connection refused" } }));

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("connection refused");
  });
});
