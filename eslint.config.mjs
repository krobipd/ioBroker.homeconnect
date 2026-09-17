import config from "@iobroker/eslint-config";

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs", "vitest.config.mts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    ignores: [
      // Session files of the note-taking hook: its cooldown marker
      // tmp/last-ndc.ts is a timestamp, not TypeScript — never lint them.
      ".remember/**",
      ".dev-server/",
      ".vscode/",
      "*.test.js",
      // Only the ioBroker template harnesses under test/ stay out — the
      // synchronised standards suite (test/standards/*.test.ts) is linted like
      // every other test file (Entwicklung/CLAUDE.md, fleet rule 2026-09-02).
      "test/*.js",
      "test/*.cjs",
      "test/fixtures/**",
      "*.config.mjs",
      "tasks.js",
      "build",
      // Generated coverage report (npm run coverage) — never lint it.
      "coverage",
      "admin",
      "src-admin",
      "node_modules",
      "**/adapter-config.d.ts",
    ],
  },
];
