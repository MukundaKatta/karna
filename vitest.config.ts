import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@karna/agent",
        replacement: fileURLToPath(new URL("./agent/src", import.meta.url)),
      },
      {
        find: /^@karna\/shared\/types\/(.*)$/,
        replacement: fileURLToPath(new URL("./packages/shared/src/types/$1", import.meta.url)),
      },
      {
        find: /^@karna\/shared\/utils\/(.*)$/,
        replacement: fileURLToPath(new URL("./packages/shared/src/utils/$1", import.meta.url)),
      },
      {
        find: "@karna/shared",
        replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      },
      {
        find: "@karna/supabase",
        replacement: fileURLToPath(new URL("./packages/supabase/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
