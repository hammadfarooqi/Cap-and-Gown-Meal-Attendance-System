import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serviceClient } from "@/lib/db/client";
import {
  isAdmin, listAdmins, addAdmin, removeAdmin, resetAdminPassword,
  countAdmins, LastAdminError,
} from "./admin";

const db = serviceClient();
const DOMAIN = "@admintest.invalid";

/** Remove every account this file created, whichever half exists. */
async function purge() {
  const { data: rows } = await db.from("admins").select("user_id, email").like("email", `%${DOMAIN}`);
  for (const row of rows ?? []) {
    await db.from("admins").delete().eq("user_id", row.user_id);
    await db.auth.admin.deleteUser(row.user_id).catch(() => {});
  }

  const { data: users } = await db.auth.admin.listUsers();
  for (const user of users?.users ?? []) {
    if (user.email?.endsWith(DOMAIN)) await db.auth.admin.deleteUser(user.id).catch(() => {});
  }
}

beforeEach(purge);
afterEach(purge);

const email = (name: string) => `${name}${DOMAIN}`;

describe("isAdmin", () => {
  it("recognises someone on the allowlist", async () => {
    const { userId } = await addAdmin(email("alice"), "correct horse battery", null);
    expect(await isAdmin(userId)).toBe(true);
  });

  it("REFUSES A VALID AUTH USER WHO IS NOT ON THE ALLOWLIST", async () => {
    // Authentication is not authorisation. Supabase Auth will accept any user
    // it holds; membership of the admins table is what makes an officer.
    const { data } = await db.auth.admin.createUser({
      email: email("stranger"), password: "let me in please", email_confirm: true,
    });

    expect(await isAdmin(data.user!.id)).toBe(false);
  });

  it("refuses a user id that does not exist at all", async () => {
    expect(await isAdmin("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("refuses a removed admin immediately", async () => {
    await addAdmin(email("keeper"), "stays behind", null);
    const { userId } = await addAdmin(email("leaver"), "graduating soon", null);

    await removeAdmin(userId);

    expect(await isAdmin(userId)).toBe(false);
  });
});

describe("addAdmin", () => {
  it("creates the auth user and the allowlist row together", async () => {
    const { userId } = await addAdmin(email("alice"), "correct horse battery", null);

    const { data } = await db.auth.admin.getUserById(userId);
    expect(data.user?.email).toBe(email("alice"));
    expect(await isAdmin(userId)).toBe(true);
  });

  it("records who added them", async () => {
    const { userId: adder } = await addAdmin(email("chair"), "first officer", null);
    const { userId: added } = await addAdmin(email("treasurer"), "second officer", adder);

    const admins = await listAdmins();
    expect(admins.find((a) => a.userId === added)?.addedBy).toBe(adder);
  });

  it("leaves no orphaned auth user when the allowlist insert fails", async () => {
    const { userId } = await addAdmin(email("alice"), "correct horse battery", null);

    // A second insert for the same user id violates the primary key.
    await expect(
      addAdmin(email("alice"), "different password", null),
    ).rejects.toBeTruthy();

    const { data } = await db.auth.admin.listUsers();
    const matching = data.users.filter((u) => u.email === email("alice"));
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(userId);
  });
});

/**
 * These assertions depend on how many admins exist in total, so they must own
 * the table. A developer's own login sitting in the same database would
 * otherwise make them fail — which is exactly what happened on 2026-08-25.
 *
 * Rows are parked and put back, never deleted: the auth users are untouched,
 * so a real account survives intact.
 */
async function withOnlyTestAdmins<T>(body: () => Promise<T>): Promise<T> {
  const { data: parked } = await db
    .from("admins").select("*").not("email", "like", `%${DOMAIN}`);

  if (parked?.length) {
    await db.from("admins").delete().not("email", "like", `%${DOMAIN}`);
  }

  try {
    return await body();
  } finally {
    if (parked?.length) await db.from("admins").upsert(parked);
  }
}

describe("removeAdmin", () => {
  it("REFUSES TO REMOVE THE LAST ADMIN", async () => {
    // Locking every officer out of a live system cannot be undone from inside
    // the dashboard. Needing a developer to recover is the exact dependency
    // this whole design exists to remove.
    await withOnlyTestAdmins(async () => {
      const { userId } = await addAdmin(email("only"), "the last one", null);

      await expect(removeAdmin(userId)).rejects.toBeInstanceOf(LastAdminError);
      expect(await isAdmin(userId)).toBe(true);
    });
  });

  it("removes one of several", async () => {
    await withOnlyTestAdmins(async () => {
      await addAdmin(email("keeper"), "stays behind", null);
      const { userId } = await addAdmin(email("leaver"), "graduating soon", null);

      await removeAdmin(userId);

      expect(await countAdmins()).toBe(1);
    });
  });

  it("deletes the auth user too, so the email can be re-added later", async () => {
    await addAdmin(email("keeper"), "stays behind", null);
    const { userId } = await addAdmin(email("leaver"), "graduating soon", null);

    await removeAdmin(userId);

    const { data } = await db.auth.admin.getUserById(userId);
    expect(data.user).toBeNull();

    await expect(addAdmin(email("leaver"), "new officer", null)).resolves.toBeTruthy();
  });
});

describe("resetAdminPassword", () => {
  it("changes the password without touching the allowlist", async () => {
    const { userId } = await addAdmin(email("alice"), "old password here", null);

    await resetAdminPassword(userId, "brand new password");

    expect(await isAdmin(userId)).toBe(true);
    expect((await listAdmins()).find((a) => a.userId === userId)?.email).toBe(email("alice"));
  });
});
