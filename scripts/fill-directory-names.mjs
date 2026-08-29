/**
 * Fill `directory_name` for everybody who has none.
 *
 * Run once after migration 0008, and again after a roster upload made before
 * the upload learned to do it itself. Safe to re-run: it only touches rows
 * where the column is null.
 *
 *   npm run fill-directory-names
 *
 * Reads name fields only, for people already in the roster. Writes nothing to
 * disk and prints no names.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "ldapts";

loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: people, error } = await db
  .from("people")
  .select("netid")
  .is("directory_name", null);

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`${people.length} people have no directory name yet.`);

let filled = 0;
let absent = 0;
let unavailable = 0;

for (const { netid } of people) {
  const client = new Client({
    url: "ldaps://ldap.princeton.edu:636",
    timeout: 4000,
    connectTimeout: 4000,
  });
  try {
    await client.bind("", "");
    const { searchEntries } = await client.search(
      `uid=${netid},o=Princeton University,c=US`,
      { scope: "base", filter: "(objectclass=*)", attributes: ["displayName"] },
    );
    const name = searchEntries[0]?.displayName;
    const fullName = Array.isArray(name) ? name[0] : name;
    if (typeof fullName === "string" && fullName.trim()) {
      await db.from("people").update({ directory_name: fullName.trim() }).eq("netid", netid);
      filled += 1;
    } else {
      absent += 1;
    }
  } catch (e) {
    if (e?.code === 32) absent += 1;
    else unavailable += 1;
  } finally {
    await client.unbind().catch(() => {});
  }
  // Polite: this is somebody else's directory.
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`filled ${filled} · not in the directory ${absent} · could not ask ${unavailable}`);
