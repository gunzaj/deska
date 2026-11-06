// Flat ESLint config.
//
// This file previously declared only `ignores`, so `pnpm lint` exited 0
// unconditionally and CI's lint step caught nothing at all.
//
// eslint-config-next is deliberately not used: its @rushstack/eslint-patch
// cannot load under ESLint 9. The Next-specific rules it would add are mostly
// framework conventions; the correctness rules below are what actually caught
// bugs during review.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-e2e/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "drizzle/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      "no-constant-binary-expression": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Type-aware rules (v5 5.2). An unawaited promise swallows real bugs: a
    // failed write, an unhandled rejection. Mark a deliberate fire-and-forget
    // with `void`.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Console output is intentional here (the worker logs its cycles).
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Plain Node scripts (the leak guard runs before `pnpm install`, so it has
    // no imports to infer globals from).
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } },
  },
);