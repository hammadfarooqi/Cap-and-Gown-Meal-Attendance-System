# Offline App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the station app load with no network, so a tablet that reboots or is refreshed during a Wi-Fi outage comes back serving instead of showing a browser error.

**Architecture:** A hand-written service worker caches the app shell and serves it when the network does not answer. It is network-first, so an online tablet always runs current code. It never touches `/api/`. A web manifest makes the app installable, which gives a fullscreen kiosk with no address bar and no pull-to-refresh.

**Tech Stack:** Plain service worker in `public/sw.js`, no library. Playwright for verification.

**Spec:** `docs/specs/2026-08-16-meal-attendance-system-design.md`

**Why this exists:** `e2e/offline.spec.ts` test 5, marked `test.fixme` on 2026-08-17. IndexedDB holds everything needed to serve a meal, but the shell is fetched over the network, so the warm cache is unreachable after a reload during an outage.

## Global Constraints

- **`/api/` is never cached.** A stale API response is worse than no response: a tablet could resolve a card from an old answer, or believe a sync succeeded when it did not. The four-case resolution already handles a failed call correctly.
- **Network-first for everything else.** Cache-first is the usual advice and it is wrong here. A tablet must never keep running yesterday's build after a fix is deployed mid-semester.
- **No PWA library.** `next-pwa` and its peers are built around cache-first assumptions and add a dependency that has to survive graduation. The whole file is about a hundred lines.
- **Every task ends with a commit** leaving `npm test`, `npm run test:e2e`, and `npm run build` green. Verify with `set -o pipefail`.

---

### Task 1: The service worker

**Files:**
- Create: `public/sw.js`
- Create: `app/station/useServiceWorker.ts`
- Modify: `app/station/page.tsx` — register on mount

**Interfaces:**
- Produces: `useServiceWorker(): void` — registers `/sw.js` at scope `/`, does nothing where service workers are unavailable.

- [x] **Step 1: Write the service worker**

Bundle filenames are content-hashed and unknown ahead of time, so the shell cannot be listed statically. Instead the worker caches **as it goes**: `install` seeds `/station`, and every successful same-origin GET afterwards is stored. One online load leaves the tablet fully armed.

Rules, in order:

```
method !== GET            → ignore, let it through
cross-origin              → ignore
path starts with /api/    → ignore, NEVER cache
otherwise                 → network first, fall back to cache
navigation with no cache  → fall back to the cached /station shell
```

`skipWaiting()` and `clients.claim()` so a new worker takes over on the next load rather than waiting for every tab to close. Combined with network-first, a deploy reaches the tablets on their next launch.

`activate` deletes every cache whose name is not the current version, so old builds do not accumulate on a device that lives for four years.

- [x] **Step 2: Register it**

A small hook, called from the station page. Guard on `"serviceWorker" in navigator` so a browser without support — or a test environment — is unaffected.

- [x] **Step 3: Verify and commit**

```bash
set -o pipefail && npm test && npm run build
git add public/sw.js app/station
git commit -m "feat: cache the app shell in a service worker"
```

---

### Task 2: The manifest and installability

**Files:**
- Create: `public/manifest.json`
- Create: `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`
- Modify: `app/layout.tsx` — manifest link and apple-touch-icon

- [x] **Step 1: Icons**

A plain monogram. Rendered to PNG at 192 and 512, because iOS ignores SVG icons in a manifest and needs `apple-touch-icon`.

- [x] **Step 2: Manifest**

`start_url` is `/station`, `display` is `fullscreen`. Added to the iPad home screen, the app opens with no address bar — which also removes the pull-to-refresh gesture that triggers the whole problem.

- [x] **Step 3: Verify and commit**

---

### Task 3: Turn the fixme into a passing test

**Files:**
- Modify: `e2e/offline.spec.ts`

- [x] **Step 1: Un-skip test 5**

Warm the station, go offline, reload, and assert the app reaches idle and can still check someone in. It must wait for the service worker to control the page before going offline — a worker that has registered but not yet taken control will not intercept anything, and the test would fail for the wrong reason.

- [x] **Step 2: Verify and commit**

```bash
set -o pipefail && npm test && npm run test:e2e && npm run build
```


---

## Executed 2026-08-17

All three tasks complete. `e2e/offline.spec.ts` test 5 passes.

**One thing the plan did not anticipate.** The test failed at first against
`next dev`, and the reason was not the service worker. Turbopack regenerates
chunk hashes on every dev compile, so the worker cached one set of bundle
filenames and the reloaded HTML asked for a different set. Every chunk 404'd.

That cannot happen in production, where content hashes are stable. The fix was
to point Playwright's `webServer` at `npm run build && npm start` instead of
`npm run dev` — which also means the whole e2e suite now exercises what
actually ships. The full run still finishes in about sixteen seconds.
