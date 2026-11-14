import type { Metadata } from "next";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { Navigation } from "../components/navigation";
import { themeVariables } from "../lib/theme";
import { database } from "../server/db/connection";
import { currentUser } from "../server/session";
import { userAppearance } from "../server/users/users";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nestegg",
  description: "A personal budgeting workspace",
};

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const user = await currentUser();
  const { color, mode } = userAppearance(database(), user.id);
  const palette = themeVariables(color) as CSSProperties;

  return <html lang="en" data-color-mode={mode} style={palette}><body>
    <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)] compact:block">
      <Navigation />
      <main className="min-w-0 p-[clamp(18px,4vw,48px)]"><div className="mx-auto max-w-[1372px]">{children}</div></main>
    </div>
  </body></html>;
}
