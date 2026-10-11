import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests are .tsx; Next keeps jsx as "preserve", so tell the test transform to compile it.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Same alias as tsconfig.json, so route handlers can be imported by tests.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // The database tests start an in-process Postgres (PGlite) and apply every migration.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
