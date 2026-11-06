import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

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

// Apply the saved theme before paint so there is no light/dark flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("deska-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The middleware's per-request CSP nonce (v5 4.10): the inline theme snippet
  // needs it, and reading the header makes every page render per request.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Browsers hide a nonce from the DOM once applied, so the client sees
            nonce="" where the server sent the value: not a real mismatch. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
