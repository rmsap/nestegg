import type { Metadata } from "next";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { Navigation } from "../components/navigation";
import { themeVariables } from "../lib/theme";
import { ownerPrimaryColor } from "../server/users/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nestegg",
  description: "A personal budgeting workspace",
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const palette = themeVariables(ownerPrimaryColor()) as CSSProperties;

  return <html lang="en" style={palette}><body>
    <div className="mx-auto grid min-h-dvh max-w-[1440px] grid-cols-[auto_minmax(0,1fr)] compact:block">
      <Navigation />
      <main className="min-w-0 p-[clamp(18px,4vw,48px)]">{children}</main>
    </div>
  </body></html>;
}
