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

// Testing Library's automatic cleanup only registers itself when Vitest
// globals are enabled, and they are not. Without this every render piles up
// in the same document and queries fail with "multiple elements found".
afterEach(cleanup);
