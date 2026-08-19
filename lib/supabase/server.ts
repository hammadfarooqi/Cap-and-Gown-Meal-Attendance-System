import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * A Supabase client bound to the request's cookies, for server components and
 * route handlers.
 *
 * This uses the ANON key deliberately. It carries the signed-in officer's
 * identity and nothing more; row-level security denies it every table. Reads
 * of club data go through the service-role client after requireAdmin() has
 * said who is asking.
 */
export async function sessionClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) {
              store.set(name, value, options);
            }
          } catch {
            // Called from a server component, where cookies are read-only.
            // Middleware and route handlers refresh the session instead.
          }
        },
      },
    },
  );
}
