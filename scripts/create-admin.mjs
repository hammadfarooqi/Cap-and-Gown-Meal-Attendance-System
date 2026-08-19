/**
 * Create the first officer account.
 *
 * There is no admin, so no admin can create one. This is the one-time
 * bootstrap, run from a terminal by whoever holds the service-role key:
 *
 *   npm run create-admin -- someone@princeton.edu 'a good long password'
 *
 * Every account after this one is created inside the dashboard.
 *
 * Deliberately standalone: plain JavaScript, importing nothing from the app.
 * It has to run years from now, on a machine belonging to a club member who
 * has never built this project, without a toolchain or a path alias in the
 * way.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: npm run create-admin -- <email> <password>");
  process.exit(1);
}

if (password.length < 12) {
  console.error("Use at least 12 characters. This account owns every student's data.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// No email is ever sent, so there is no confirmation link to click.
const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

const { error: rowError } = await db
  .from("admins")
  .insert({ user_id: data.user.id, email, added_by: null });

if (rowError) {
  // Never leave an account that can sign in but is allowed nowhere.
  await db.auth.admin.deleteUser(data.user.id);
  console.error(rowError.message);
  process.exit(1);
}

const { count } = await db.from("admins").select("*", { count: "exact", head: true });
console.log(`Created ${email}. Admins now: ${count}`);
