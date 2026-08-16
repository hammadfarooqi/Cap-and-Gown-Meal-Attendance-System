import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server-side and tests only — never ship to a browser.
 *
 * This key bypasses every access rule in the database, which is why the
 * environment variable that holds it must never carry the NEXT_PUBLIC_ prefix.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
