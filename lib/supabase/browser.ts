import { createBrowserClient } from "@supabase/ssr";

/** The signed-in officer's client. Used only to sign in and sign out. */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
