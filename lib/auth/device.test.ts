import { describe, it, expect, afterEach } from "vitest";
import { serviceClient } from "@/lib/db/client";
import {
  hashToken,
  createEnrollmentCode,
  redeemEnrollmentCode,
  authenticateDevice,
} from "./device";

const db = serviceClient();

// Devices created here are named with this prefix so cleanup can scope itself
// and never touch a device another test file is relying on.
const PREFIX = "authtest-";

afterEach(async () => {
  const { data } = await db.from("devices").select("id").like("name", `${PREFIX}%`);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
  await db.from("enrollment_codes").delete().like("name", `${PREFIX}%`);
});

const withToken = (token: string) =>
  new Request("http://localhost/api/sync", {
    headers: { authorization: `Bearer ${token}` },
  });

describe("device tokens", () => {
  it("never stores the plaintext token", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    const { data } = await db
      .from("devices")
      .select("token_hash")
      .eq("id", redeemed!.deviceId)
      .single();

    expect(data!.token_hash).not.toBe(redeemed!.token);
    expect(data!.token_hash).toBe(hashToken(redeemed!.token));
  });

  it("carries the device name from the code through to the device", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    const { data } = await db
      .from("devices")
      .select("name")
      .eq("id", redeemed!.deviceId)
      .single();

    expect(data!.name).toBe(`${PREFIX}Lane 1`);
  });

  it("authenticates a device with a valid token", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    expect(await authenticateDevice(withToken(redeemed!.token)))
      .toEqual({ deviceId: redeemed!.deviceId });
  });

  it("records last_seen_at when a device authenticates", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    await authenticateDevice(withToken(redeemed!.token));

    const { data } = await db
      .from("devices")
      .select("last_seen_at")
      .eq("id", redeemed!.deviceId)
      .single();

    expect(data!.last_seen_at).not.toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await authenticateDevice(withToken("not-a-real-token"))).toBeNull();
  });

  it("rejects a request with no authorization header", async () => {
    expect(await authenticateDevice(new Request("http://localhost/api/sync"))).toBeNull();
  });

  it("rejects a malformed authorization header", async () => {
    const req = new Request("http://localhost/api/sync", {
      headers: { authorization: "Basic abc123" },
    });
    expect(await authenticateDevice(req)).toBeNull();
  });

  it("rejects a revoked device", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    const redeemed = await redeemEnrollmentCode(code);

    await db
      .from("devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", redeemed!.deviceId);

    expect(await authenticateDevice(withToken(redeemed!.token))).toBeNull();
  });
});

describe("enrollment codes", () => {
  it("refuses a code that has already been used", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    expect(await redeemEnrollmentCode(code)).not.toBeNull();
    expect(await redeemEnrollmentCode(code)).toBeNull();
  });

  it("refuses an expired code", async () => {
    const { code } = await createEnrollmentCode(`${PREFIX}Lane 1`);
    await db
      .from("enrollment_codes")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("code", code);

    expect(await redeemEnrollmentCode(code)).toBeNull();
  });

  it("refuses a code that does not exist", async () => {
    expect(await redeemEnrollmentCode("ZZZZZZZZ")).toBeNull();
  });

  it("issues a different token to each device", async () => {
    const a = await redeemEnrollmentCode((await createEnrollmentCode(`${PREFIX}Lane 1`)).code);
    const b = await redeemEnrollmentCode((await createEnrollmentCode(`${PREFIX}Lane 2`)).code);

    expect(a!.token).not.toBe(b!.token);
    expect(a!.deviceId).not.toBe(b!.deviceId);
  });
});
