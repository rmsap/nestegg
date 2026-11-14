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
  return <nav aria-label="Main navigation">
    {pages.map(({ href, label }) => <Link key={href} href={href}
      aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
