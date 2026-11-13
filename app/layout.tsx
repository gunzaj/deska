import "./globals.css";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { readTheme } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: "Deska", template: "%s · Deska" },
  description: "Fast triage, backlog and release planning on top of GitHub issues",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#151719" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request, so the stored theme (ADR-001) is on <html>
  // from the first byte: no pre-paint script, no flash, and it survives a
  // relaunch (the window's origin, and with it localStorage, changes each time).
  await connection();
  const theme = await readTheme();
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
