// Runs once when the server starts (Next.js instrumentation hook). The Node-only
// work lives in its own module so the Edge bundle never pulls in `pg`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
