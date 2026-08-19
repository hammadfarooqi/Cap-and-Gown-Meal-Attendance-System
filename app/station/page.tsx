"use client";

import { useEffect, useState } from "react";
import { openStore, type StationStore } from "@/lib/station/store";
import { api } from "@/lib/station/api";
import { getDeviceToken } from "@/lib/station/session";
import { StationScreen } from "./StationScreen";
import { EnrollScreen } from "./EnrollScreen";
import { useServiceWorker } from "./useServiceWorker";

/**
 * The shell. It owns nothing but the two things that cannot be decided until
 * the browser is running: whether this tablet is enrolled, and the handle to
 * its local database. Every decision lives in lib/station/.
 */
export default function StationPage() {
  const [store, setStore] = useState<StationStore | null>(null);
  const [deviceToken, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Caches the app shell, so a reload during an outage still boots.
  useServiceWorker();

  useEffect(() => {
    let live = true;
    (async () => {
      const opened = await openStore();
      if (!live) return;
      setStore(opened);
      setToken(getDeviceToken());
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!ready || !store) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-2xl text-slate-500">Starting…</p>
      </main>
    );
  }

  if (!deviceToken) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <EnrollScreen onEnrolled={() => setToken(getDeviceToken())} />
      </main>
    );
  }

  return <StationScreen store={store} api={api} deviceToken={deviceToken} />;
}
