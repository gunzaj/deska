import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Postgres e2e server runs next to the mocked one (S11) and needs its
  // own build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The desktop app runs Next's standalone server (`pnpm desktop:build` sets
  // this); other builds (CI, `pnpm start`) stay as they were.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // PGlite loads its WASM and data files from its own package folder at run
  // time, so it is required from node_modules instead of bundled; one copy per
  // process also keeps a single database instance (db/index.ts).
  serverExternalPackages: ["@electric-sql/pglite"],
  // The standalone build carries the migrations (PGlite's WASM, data bundle
  // and pg_trgm extension are traced from its imports).
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  // No image optimization: the desktop build drops sharp, whose native
  // binaries exist for one architecture only (scripts/desktop.mjs).
  images: { unoptimized: true },
  // Next truncates request bodies at 10 MB when a middleware matches (it matches
  // every path here), and the cut JSON would read as "not a Deska file". An export
  // with a long task history is larger. Keep in step with MAX_IMPORT_BYTES
  // (lib/backup/local-data.ts), which answers a larger file with a clear error.
  experimental: { middlewareClientMaxBodySize: "100mb" },
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
