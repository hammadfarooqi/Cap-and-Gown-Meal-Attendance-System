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
  { href: "/admin/admins", label: "Officers" },
];

export function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 py-3">
      {SECTIONS.map((section) => {
        const active =
          section.href === "/admin" ? pathname === "/admin" : pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm ${
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {section.label}
          </Link>
        );
      })}

      <div className="ml-auto flex items-center gap-3">
        {/* Officers share iPads. Showing the account avoids someone making
            changes under a colleague's name without realising. */}
        <span className="text-sm text-slate-500">{email}</span>
        <button
          type="button"
          onClick={async () => {
            await browserClient().auth.signOut();
            router.replace("/admin/login");
            router.refresh();
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
