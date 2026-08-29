import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MealWindow } from "@/lib/meals/types";
import type { Versions } from "@/lib/api/envelope";

export type CachedPerson = {
  netid: string;
  fullName: string;
  /**
   * What the University calls them, when it differs from the roster.
   *
   * Never shown. Used only so a card printed with somebody's legal name
   * still matches a roster entry holding the name they go by.
   */
  directoryName?: string | null;
  isMember: boolean;
  homeClub: string | null;
  photoPath: string | null;
};

export type Credential = { token: string; netid: string };

/**
 * Photos persist as raw bytes plus a MIME type rather than as a Blob.
 *
 * Storing a Blob directly is legal, but iPadOS Safari has a long history of
 * mishandling Blobs in IndexedDB, and these run on tablets. Bytes and a
 * string structured-clone reliably on every engine, and rebuilding the Blob
 * on read costs nothing.
 */
type StoredPhoto = { type: string; bytes: ArrayBuffer };

export type OutboxItem =
  | { kind: "swipe"; netid: string; scannedAt: string; entryMethod: "scan" | "manual" }
  | { kind: "binding"; token: string; netid: string };

/** An outbox item as it comes back out, carrying the key it was stored under. */
export type QueuedItem = OutboxItem & { id: number };

export type BootstrapData = {
  people: CachedPerson[];
  credentials: Credential[];
  schedule: MealWindow[];
  clubs: string[];
  versions: Versions;
};

const DB_NAME = "cap-station";
const DB_VERSION = 1;

interface StationSchema extends DBSchema {
  meta: { key: string; value: unknown };
  people: { key: string; value: CachedPerson };
  credentials: { key: string; value: Credential; indexes: { netid: string } };
  photos: { key: string; value: StoredPhoto };
  outbox: { key: number; value: OutboxItem };
}

export type StationStore = Awaited<ReturnType<typeof openStore>>;

/**
 * Everything the tablet knows, in IndexedDB.
 *
 * One module owns the schema so nothing else touches a raw object store. The
 * split that matters is between data the server owns — the roster, the token
 * map, the schedule — and data the tablet owns: the photo cache and the
 * outbox. A refresh replaces the former wholesale and must never touch the
 * latter.
 */
export async function openStore() {
  const db: IDBPDatabase<StationSchema> = await openDB<StationSchema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("meta");
      database.createObjectStore("people", { keyPath: "netid" });
      const credentials = database.createObjectStore("credentials", { keyPath: "token" });
      credentials.createIndex("netid", "netid");
      database.createObjectStore("photos");
      database.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    },
  });

  return {
    /**
     * Replace everything the server owns, in one transaction.
     *
     * People and credentials are cleared rather than merged: a departed member
     * has to actually vanish from the picker. Photos and the outbox are
     * deliberately untouched — a roster version bump because someone fixed a
     * typo must not cost 12MB of headshots or a rush's worth of unsent scans.
     */
    async putBootstrap(data: BootstrapData): Promise<void> {
      const tx = db.transaction(["meta", "people", "credentials"], "readwrite");
      const people = tx.objectStore("people");
      const credentials = tx.objectStore("credentials");
      const meta = tx.objectStore("meta");

      await Promise.all([people.clear(), credentials.clear()]);
      await Promise.all([
        ...data.people.map((p) => people.put(p)),
        ...data.credentials.map((c) => credentials.put(c)),
        meta.put(data.schedule, "schedule"),
        meta.put(data.clubs, "clubs"),
        meta.put(data.versions, "versions"),
      ]);
      await tx.done;
    },

    async resolveToken(token: string): Promise<CachedPerson | null> {
      const credential = await db.get("credentials", token);
      if (!credential) return null;
      return (await db.get("people", credential.netid)) ?? null;
    },

    async addCredential(token: string, netid: string): Promise<void> {
      await db.put("credentials", { token, netid });
    },

    async putPerson(person: CachedPerson): Promise<void> {
      await db.put("people", person);
    },

    async allMembers(): Promise<CachedPerson[]> {
      return (await db.getAll("people")).filter((p) => p.isMember);
    },

    /** Everyone the tablet knows, members and guests alike. */
    async allPeople(): Promise<CachedPerson[]> {
      return db.getAll("people");
    },

    /**
     * Everyone with no card bound yet, members AND guests.
     *
     * A guest entered by hand has a person row and no credential. When they
     * turn up later carrying a card, the name on it should offer them the
     * same way it offers a member — they are just as unbound.
     */
    async unboundPeople(): Promise<CachedPerson[]> {
      const [people, credentials] = await Promise.all([
        db.getAll("people"),
        db.getAll("credentials"),
      ]);
      const bound = new Set(credentials.map((c) => c.netid));
      return people.filter((p) => !bound.has(p.netid));
    },

    async getSchedule(): Promise<MealWindow[]> {
      return ((await db.get("meta", "schedule")) as MealWindow[] | undefined) ?? [];
    },

    /** The eleven eating clubs plus 'None', for the guest form's dropdown. */
    async getClubs(): Promise<string[]> {
      return ((await db.get("meta", "clubs")) as string[] | undefined) ?? [];
    },

    /**
     * A second copy of the device token.
     *
     * localStorage is the primary home because the token is needed
     * synchronously before anything else can start. But a tablet at the club
     * lost its localStorage key while this database survived intact — 2MB of
     * cache still present — so one copy is not enough. `putBootstrap` only
     * writes named keys into `meta`, so this survives a re-warm.
     */
    async getTokenBackup(): Promise<string | null> {
      return ((await db.get("meta", "deviceToken")) as string | undefined) ?? null;
    },

    async putTokenBackup(token: string): Promise<void> {
      await db.put("meta", token, "deviceToken");
    },

    async clearTokenBackup(): Promise<void> {
      await db.delete("meta", "deviceToken");
    },

    async getVersions(): Promise<Versions | null> {
      return ((await db.get("meta", "versions")) as Versions | undefined) ?? null;
    },

    async putVersions(versions: Versions): Promise<void> {
      await db.put("meta", versions, "versions");
    },

    async putPhoto(path: string, blob: Blob): Promise<void> {
      await db.put("photos", { type: blob.type, bytes: await blob.arrayBuffer() }, path);
    },

    async getPhoto(path: string): Promise<Blob | undefined> {
      const stored = await db.get("photos", path);
      return stored ? new Blob([stored.bytes], { type: stored.type }) : undefined;
    },

    async hasPhoto(path: string): Promise<boolean> {
      return (await db.getKey("photos", path)) !== undefined;
    },

    async enqueue(item: OutboxItem): Promise<void> {
      await db.add("outbox", item);
    },

    /** Oldest first, each carrying its key so it can be removed once sent. */
    async peekOutbox(limit = 100): Promise<QueuedItem[]> {
      const items: QueuedItem[] = [];
      let cursor = await db.transaction("outbox").store.openCursor();
      while (cursor && items.length < limit) {
        items.push({ ...cursor.value, id: cursor.key });
        cursor = await cursor.continue();
      }
      return items;
    },

    async removeFromOutbox(ids: number[]): Promise<void> {
      const tx = db.transaction("outbox", "readwrite");
      await Promise.all(ids.map((id) => tx.store.delete(id)));
      await tx.done;
    },

    async outboxSize(): Promise<number> {
      return db.count("outbox");
    },

    close(): void {
      db.close();
    },
  };
}
