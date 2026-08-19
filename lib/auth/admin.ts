import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/db/client";
import { sessionClient } from "@/lib/supabase/server";

export type Admin = {
  userId: string;
  email: string;
  addedAt: string;
  addedBy: string | null;
};

export class LastAdminError extends Error {
  constructor() {
    super("Cannot remove the last admin");
    this.name = "LastAdminError";
  }
}

/**
 * Being signed in is not the same as being allowed in.
 *
 * Supabase Auth will accept any user it holds. Membership of this table is
 * what makes someone an officer, so every gate checks here and not merely
 * that a session exists.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data);
}

export async function listAdmins(): Promise<Admin[]> {
  const { data, error } = await serviceClient()
    .from("admins")
    .select("user_id, email, added_at, added_by")
    .order("added_at");
  if (error) throw error;

  return data.map((row) => ({
    userId: row.user_id,
    email: row.email,
    addedAt: row.added_at,
    addedBy: row.added_by,
  }));
}

export async function countAdmins(): Promise<number> {
  const { count } = await serviceClient()
    .from("admins")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

/**
 * Create an officer's account and put them on the allowlist.
 *
 * Both, or neither. An auth user without an allowlist row can sign in and see
 * nothing; an allowlist row without an auth user cannot sign in at all. Either
 * half alone is a support call.
 */
export async function addAdmin(
  email: string,
  password: string,
  addedBy: string | null,
): Promise<{ userId: string }> {
  const db = serviceClient();

  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password,
    // No email is ever sent, so there is no confirmation link to click.
    email_confirm: true,
  });
  if (error || !created.user) throw error ?? new Error("could not create user");

  const { error: rowError } = await db.from("admins").insert({
    user_id: created.user.id,
    email,
    added_by: addedBy,
  });

  if (rowError) {
    // Roll back, rather than leaving an account that can sign in to nothing.
    await db.auth.admin.deleteUser(created.user.id);
    throw rowError;
  }

  return { userId: created.user.id };
}

/**
 * Remove an officer entirely.
 *
 * Refuses to remove the last one. Locking every officer out of a live system
 * cannot be undone from inside the dashboard, and needing a developer to
 * recover is the exact dependency this design exists to remove.
 */
export async function removeAdmin(userId: string): Promise<void> {
  if ((await countAdmins()) <= 1) throw new LastAdminError();

  const db = serviceClient();

  const { error } = await db.from("admins").delete().eq("user_id", userId);
  if (error) throw error;

  // Delete the auth user too, or the email can never be re-added.
  await db.auth.admin.deleteUser(userId);
}

export async function resetAdminPassword(userId: string, password: string): Promise<void> {
  const { error } = await serviceClient().auth.admin.updateUserById(userId, { password });
  if (error) throw error;
}

/**
 * The gate on every /admin route. Redirects rather than throwing, and gives
 * the same answer whether the visitor is signed out or merely not an officer —
 * so the login page cannot be used to find out who is on the board.
 */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const supabase = await sessionClient();
  const { data } = await supabase.auth.getUser();

  const user = data.user;
  if (!user || !(await isAdmin(user.id))) redirect("/admin/login");

  return { userId: user.id, email: user.email ?? "" };
}
