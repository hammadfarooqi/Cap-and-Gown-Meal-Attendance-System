import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { config as loadEnv } from "dotenv";

// Vitest does not read .env.local the way `next dev` does. Without this,
// every integration test fails at serviceClient() with "Missing
// NEXT_PUBLIC_SUPABASE_URL", which looks like a code bug and is not.
loadEnv({ path: ".env.local" });

// Every test runs as if the tablet is in the club's timezone.
process.env.TZ = "America/New_York";

// Node 25 ships its own localStorage, which throws unless the process was
// started with --localstorage-file, and it shadows the one jsdom provides.
// An in-memory stand-in is enough: nothing here needs it to outlive the run,
// and without it any test touching the device token dies on import.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
});

// Testing Library's automatic cleanup only registers itself when Vitest
// globals are enabled, and they are not. Without this every render piles up
// in the same document and queries fail with "multiple elements found".
afterEach(cleanup);
