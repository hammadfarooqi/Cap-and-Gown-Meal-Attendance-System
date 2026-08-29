import type { StationStore } from "./store";

const STORAGE_KEY = "deviceToken";

/**
 * The device token, held in localStorage.
 *
 * Deliberately not IndexedDB: this is one short string that the app needs
 * synchronously before it can do anything else, and localStorage survives a
 * reboot just as well.
 */
export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setDeviceToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearDeviceToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * The device token, from whichever copy still exists.
 *
 * A tablet at the club showed the enrolment screen after a plain refresh:
 * same browser, same tab, same URL, a device the server still accepted, and a
 * token that cannot expire. Its localStorage key had gone while 2MB of
 * IndexedDB and service-worker cache sat untouched, so eviction does not
 * explain it and nothing in the app had cleared it.
 *
 * Rather than keep guessing at the cause, the token is kept in both places
 * and either one can restore the other. A lane asking for a setup code in the
 * middle of service is not a failure worth being precise about.
 */
export async function resolveDeviceToken(store: StationStore): Promise<string | null> {
  const local = getDeviceToken();
  if (local) {
    // Cheap to keep the backup current, and covers a tablet enrolled before
    // this existed.
    await store.putTokenBackup(local);
    return local;
  }

  const backup = await store.getTokenBackup();
  if (!backup) return null;

  setDeviceToken(backup);
  return backup;
}

/** Store the token in both places at once. */
export async function rememberDeviceToken(store: StationStore, token: string): Promise<void> {
  setDeviceToken(token);
  await store.putTokenBackup(token);
}

/** Forget it in both, so a revoked tablet does not resurrect itself. */
export async function forgetDeviceToken(store: StationStore): Promise<void> {
  clearDeviceToken();
  await store.clearTokenBackup();
}

/**
 * Exchange a one-time enrolment code for a long-lived device token.
 *
 * The only station call that does not need a token already, because it is
 * how a tablet gets one.
 */
export async function enrollDevice(code: string): Promise<boolean> {
  try {
    const res = await fetch("/api/devices/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    if (!res.ok) return false;

    const { token } = await res.json();
    if (typeof token !== "string") return false;

    setDeviceToken(token);
    return true;
  } catch {
    return false;
  }
}
