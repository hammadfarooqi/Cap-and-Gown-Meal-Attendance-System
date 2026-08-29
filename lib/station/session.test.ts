import { describe, it, expect, afterEach } from "vitest";
import { openStore, type StationStore } from "./store";
import {
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
  resolveDeviceToken,
  rememberDeviceToken,
  forgetDeviceToken,
} from "./session";

const opened: { close(): void }[] = [];

async function open(): Promise<StationStore> {
  const store = await openStore();
  opened.push(store);
  return store;
}

afterEach(async () => {
  clearDeviceToken();
  for (const store of opened) store.close();
  opened.length = 0;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("cap-station");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("resolveDeviceToken", () => {
  it("RESTORES THE TOKEN when localStorage has lost it", async () => {
    // Exactly what happened on the club's tablet: same browser, same tab, a
    // device the server still accepted, and the localStorage key gone while
    // 2MB of IndexedDB sat untouched. Without this the lane asks for a setup
    // code in the middle of service.
    const store = await open();
    await rememberDeviceToken(store, "tok-abc");

    clearDeviceToken();
    expect(getDeviceToken()).toBeNull();

    expect(await resolveDeviceToken(store)).toBe("tok-abc");
  });

  it("puts the recovered token back into localStorage", async () => {
    // Otherwise every load pays for the recovery, and the synchronous read
    // the app depends on stays empty.
    const store = await open();
    await rememberDeviceToken(store, "tok-abc");
    clearDeviceToken();

    await resolveDeviceToken(store);

    expect(getDeviceToken()).toBe("tok-abc");
  });

  it("BACKS UP A TOKEN THAT ONLY localStorage HAS", async () => {
    // A tablet enrolled before this existed has no backup yet. The first load
    // after the update has to create one, or it is protected by nothing.
    const store = await open();
    setDeviceToken("tok-old");

    expect(await resolveDeviceToken(store)).toBe("tok-old");
    expect(await store.getTokenBackup()).toBe("tok-old");
  });

  it("returns null when neither copy has anything", async () => {
    const store = await open();
    expect(await resolveDeviceToken(store)).toBeNull();
  });

  it("SURVIVES A CACHE RE-WARM, which clears people and credentials", async () => {
    // putBootstrap wipes those two stores wholesale. If the token lived
    // anywhere they get cleared, every roster refresh would un-enrol the
    // tablet — a far worse bug than the one this fixes.
    const store = await open();
    await rememberDeviceToken(store, "tok-abc");

    await store.putBootstrap({
      people: [],
      credentials: [],
      schedule: [],
      clubs: [],
      versions: { roster: 2, schedule: 2 },
    });

    expect(await store.getTokenBackup()).toBe("tok-abc");
  });
});

describe("forgetDeviceToken", () => {
  it("CLEARS BOTH COPIES, so a revoked tablet cannot resurrect itself", async () => {
    // If only localStorage were cleared, the next load would restore the dead
    // token from the backup and the tablet would never come back for a code.
    const store = await open();
    await rememberDeviceToken(store, "tok-abc");

    await forgetDeviceToken(store);

    expect(getDeviceToken()).toBeNull();
    expect(await store.getTokenBackup()).toBeNull();
    expect(await resolveDeviceToken(store)).toBeNull();
  });
});
