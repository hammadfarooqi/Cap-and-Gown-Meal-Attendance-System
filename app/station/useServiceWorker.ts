"use client";

import { useEffect } from "react";

/**
 * Register the service worker that caches the app shell.
 *
 * Silent where service workers are unavailable — an unsupported browser, a
 * non-secure origin, or a test environment. The app works either way; without
 * it, a reload during a network outage simply fails to load.
 */
export function useServiceWorker(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Registration failure is not worth interrupting service for.
    });
  }, []);
}
