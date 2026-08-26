import { requireAdmin } from "@/lib/auth/admin";
import { Nav } from "../Nav";

export const metadata = { title: "Cap & Gown Dashboard" };

/**
 * One requireAdmin call guards every page beneath /admin.
 *
 * Doing it here rather than per page means a section added later is protected
 * by default, instead of being protected only if somebody remembers.
 *
 * The (dashboard) route group is what keeps /admin/login OUT of this layout
 * while still serving the dashboard at /admin. Without the group, login would
 * inherit this guard: requireAdmin would redirect to the login page, which
 * would run requireAdmin again, forever.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <Nav email={email} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
