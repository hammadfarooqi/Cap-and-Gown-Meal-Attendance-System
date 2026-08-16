import { serviceClient } from "@/lib/db/client";

export type VersionedResource = "roster" | "schedule";
export type Versions = Record<VersionedResource, number>;

export async function readVersions(): Promise<Versions> {
  const db = serviceClient();
  const { data, error } = await db.from("versions").select("resource, version");
  if (error) throw error;

  const map = Object.fromEntries(data.map((r) => [r.resource, r.version]));
  return { roster: map.roster ?? 1, schedule: map.schedule ?? 1 };
}

/**
 * Called by whatever mutates the roster or the schedule. Tablets notice on
 * their next sync and refetch only the resource that moved.
 */
export async function bumpVersion(resource: VersionedResource): Promise<void> {
  const db = serviceClient();
  const current = await readVersions();

  const { error } = await db
    .from("versions")
    .update({ version: current[resource] + 1 })
    .eq("resource", resource);
  if (error) throw error;
}

/**
 * Every station response carries the current version stamps, so a tablet
 * learns about roster and schedule changes off traffic it was already
 * sending. No polling, no push infrastructure.
 */
export async function envelope<T>(data: T): Promise<{ data: T; versions: Versions }> {
  return { data, versions: await readVersions() };
}
