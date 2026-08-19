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
