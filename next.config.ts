import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Postgres e2e server runs next to the mocked one (S11) and needs its
  // own build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker image runs Next's standalone server (Dockerfile sets this);
  // other builds (CI, `pnpm start`) stay as they were.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // The floating dev badge sits on top of the sidebar footer.
  devIndicators: false,
  // Deska edits GitHub on the user's behalf once WRITE_MODE=on, so no other
  // site may frame it (clickjacking a board drag or a close button).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
