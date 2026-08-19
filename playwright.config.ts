import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// The spec files talk to Postgres directly to set up and assert state, so
// they need the same environment the app has. Playwright runs them in plain
// Node, which does not read .env.local on its own.
loadEnv({ path: ".env.local" });

// A port of our own. Port 3000 is the default for every Next project on the
// machine, and `reuseExistingServer` will cheerfully attach to whichever one
// happens to be listening — which silently runs the whole suite against a
// different application.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // These tests share one local Postgres. Same reason as vitest.
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    // A production build, not `next dev`. Turbopack regenerates chunk hashes
    // on every dev compile, so a service worker caches one set of bundles and
    // the next load asks for different filenames — the offline-reload test
    // fails for a reason that cannot happen in production. Building also
    // means these tests exercise what actually ships.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Always start our own. See the note on PORT above.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
