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
    <div className="shell">
      <aside>
        <Link className="brand" href="/"><span aria-hidden="true">≈</span> nestegg</Link>
        <Navigation />
      </aside>
      <main>{children}</main>
    </div>
  </body></html>;
}
