import { clearStoredTokensWhenReadOnly } from "./lib/auth-tokens";

// With WRITE_MODE off, no user's GitHub token stays in the database (v5 2.8).
await clearStoredTokensWhenReadOnly();
