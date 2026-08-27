"use client";

import { useEffect, useState } from "react";
import { openStore, type StationStore } from "@/lib/station/store";
import { api } from "@/lib/station/api";
import { clearDeviceToken, getDeviceToken } from "@/lib/station/session";
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
      <main className="station-dark flex min-h-screen items-center justify-center bg-page text-ink">
        <p className="text-2xl text-ink-muted">Starting…</p>
      </main>
    );
  }

  if (!deviceToken) {
    return (
      <main className="station-dark flex min-h-screen items-center justify-center bg-page p-8 text-ink">
        <EnrollScreen onEnrolled={() => setToken(getDeviceToken())} />
      </main>
    );
  }

  return (
    <StationScreen
      store={store}
      api={api}
      deviceToken={deviceToken}
      onUnenrolled={() => {
        // Revoked from the dashboard, or the device row is gone. Forget the
        // dead token so the enrolment screen comes back on its own.
        clearDeviceToken();
        setToken(null);
      }}
    />
  );
}
