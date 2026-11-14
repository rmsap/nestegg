"use client";

import { ArrowLeftRight, Landmark, LayoutDashboard, Settings, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const pages = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation() {
  const pathname = usePathname();
  return <aside className="w-[68px] overflow-hidden border-e border-line bg-sidebar px-3 py-5 transition-[width] duration-150 hover:w-[210px] hover:delay-750 has-[:focus-visible]:w-[210px] has-[:focus-visible]:delay-0 motion-reduce:duration-0 compact:w-full compact:border-e-0 compact:border-b compact:py-2 compact:hover:w-full compact:has-[:focus-visible]:w-full">
    <Link href="/" aria-label="Nestegg home"
      className="flex min-h-11 items-center gap-3 overflow-hidden px-[6px] text-[1.4rem] font-[650] tracking-[-.035em] compact:w-fit">
      <span aria-hidden="true" className="grid size-[31px] shrink-0 place-items-center rounded-[50%_50%_50%_8px] border border-primary-border bg-primary text-on-primary">≈</span>
      <span aria-hidden="true" className="whitespace-nowrap compact:hidden">nestegg</span>
    </Link>
    <nav id="main-navigation" aria-label="Main navigation" className="mt-4 grid gap-1 compact:mt-1 compact:flex compact:flex-wrap">
      {pages.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
        aria-label={label}
        className="flex min-h-11 min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 font-[550] hover:bg-accent aria-[current=page]:bg-accent compact:w-11"
        aria-current={pathname === href ? "page" : undefined}>
        <Icon size={20} className="shrink-0" aria-hidden="true" />
        <span aria-hidden="true" className="whitespace-nowrap compact:hidden">{label}</span>
      </Link>)}
    </nav>
  </aside>;
}
