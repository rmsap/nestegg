import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "../components/navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nestegg",
  description: "A personal budgeting workspace",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <div className="mx-auto grid min-h-dvh max-w-[1440px] grid-cols-[210px_minmax(0,1fr)] compact:block">
      <aside className="border-e border-line bg-sidebar px-[18px] py-7 compact:border-e-0 compact:border-b compact:px-3 compact:pt-3.5 compact:pb-2">
        <Link className="inline-flex items-center gap-[9px] text-[1.4rem] font-[650] tracking-[-.035em]" href="/">
          <span aria-hidden="true" className="grid size-[31px] place-items-center rounded-[50%_50%_50%_8px] bg-green text-white">≈</span>
          nestegg
        </Link>
        <Navigation />
      </aside>
      <main className="min-w-0 p-[clamp(18px,4vw,48px)]">{children}</main>
    </div>
  </body></html>;
}
