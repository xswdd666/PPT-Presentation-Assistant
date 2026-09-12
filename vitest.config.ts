import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/*.e2e.test.ts", "**/node_modules/**"],
    passWithNoTests: true,
  },
});
