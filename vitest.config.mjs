import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    watch: false,
    pool: "forks",
    forks: { singleFork: false },
    coverage: {
      // Explicit include so files that no test imports still show up as 0 %
      // — without this the v8 provider silently omits them and the headline
      // number overstates real coverage (fleet lesson from the govee-smart
      // v2.16.1 audit).
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
});
