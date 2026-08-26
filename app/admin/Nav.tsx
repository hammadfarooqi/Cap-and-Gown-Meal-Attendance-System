"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

const SECTIONS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/export", label: "Export" },
  { href: "/admin/roster", label: "Roster" },
  { href: "/admin/photos", label: "Photos" },
  { href: "/admin/devices", label: "Tablets" },
];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="bg-oxblood text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        {/* The serif appears here and on the station, nowhere else. It is the
            club's identity, not a UI vocabulary. */}
        <Link href="/admin" className="font-display text-xl tracking-tight">
          The Cap and Gown Club
        </Link>

        <nav aria-label="Sections" className="flex flex-wrap items-center gap-1">
          {SECTIONS.map((section) => {
            const active =
              section.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(section.href);

            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {/* Officers share iPads. Showing the account avoids someone making
              changes under a colleague's name without realising. */}
          <span className="hidden text-sm text-white/60 sm:inline">{email}</span>
          <button
            type="button"
            onClick={async () => {
              await browserClient().auth.signOut();
              router.replace("/admin/login");
              router.refresh();
            }}
            className="rounded-md px-3 py-1.5 text-sm text-white/70 ring-1 ring-white/25 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
