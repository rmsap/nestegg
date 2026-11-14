import type { Metadata } from "next";
import { Navigation } from "../components/navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nestegg",
  description: "A personal budgeting workspace",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <div className="mx-auto grid min-h-dvh max-w-[1440px] grid-cols-[auto_minmax(0,1fr)] compact:block">
      <Navigation />
      <main className="min-w-0 p-[clamp(18px,4vw,48px)]">{children}</main>
    </div>
  </body></html>;
}
