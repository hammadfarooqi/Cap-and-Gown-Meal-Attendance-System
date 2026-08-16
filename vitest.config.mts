import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],

    // Integration tests share one local Postgres and clean up after
    // themselves. Running files in parallel lets one file's teardown delete
    // rows another file is still using, which produces failures that look
    // random and are not. Serial is fast enough at this size.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": import.meta.dirname },
  },
});
