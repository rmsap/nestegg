"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const pages = [
  { href: "/", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budget", label: "Budget" },
  { href: "/accounts", label: "Accounts" },
  { href: "/goals", label: "Goals" },
];

export function Navigation() {
  const pathname = usePathname();
  return <nav aria-label="Main navigation" className="mt-[30px] grid gap-1 compact:mt-2 compact:flex compact:flex-wrap compact:gap-0.5">
    {pages.map(({ href, label }) => <Link key={href} href={href}
      className="rounded-lg px-3 py-2.5 font-[550] hover:bg-accent aria-[current=page]:bg-accent compact:px-1.5 compact:py-2 compact:text-[.85rem]"
      aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
