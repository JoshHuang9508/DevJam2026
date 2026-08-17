import { defineConfig } from "vitest/config";

// Without this file vitest walks up to the repo root and loads the frontend's
// vitest.config.ts, which only collects lib/**/*.test.ts and aliases server-only.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
