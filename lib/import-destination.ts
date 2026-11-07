// Where /importing sends the app (SPEC D5). The page has four sequential gates
// and the first one that fails decides the redirect; the order is load-bearing, not
// cosmetic: needsProjectSetup() is the first gate that reads the database, so the
// two cheap checks have to settle before it, and a signed-out request must not
// touch the cache at all.
//
// The gates arrive as thunks so the page keeps that short-circuit while the order
// itself lives here and is unit-tested without a database or Electron.
export type ImportDestination = "onboarding" | "onboarding-step-2" | "issues" | "importing";

export type ImportGates = {
  /** getViewerLogin(): a login, or null when nobody is signed in. */
  signedIn: () => boolean | Promise<boolean>;
  /** desktopGuard(): non-null only inside the desktop app, where this page exists. */
  desktop: () => boolean;
  /** needsProjectSetup(): no stored project or no stored field mapping yet. */
  needsProjectSetup: () => boolean | Promise<boolean>;
  /** needsFirstImport(): the cache is still being filled for the first time. */
  needsFirstImport: () => boolean | Promise<boolean>;
};

export async function resolveImportDestination(gates: ImportGates): Promise<ImportDestination> {
  if (!(await gates.signedIn())) return "onboarding";
  if (!gates.desktop()) return "issues";
  if (await gates.needsProjectSetup()) return "onboarding-step-2";
  if (await gates.needsFirstImport()) return "importing";
  return "issues";
}
