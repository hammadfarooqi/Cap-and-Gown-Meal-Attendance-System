/**
 * Load a membership spreadsheet into the roster.
 *
 *   npm run load-roster -- "path/to/roster.csv" [--production]
 *
 * Without --production it writes to the local Supabase in Docker.
 *
 * Plain JavaScript with no app imports, for the same reason as
 * create-admin.mjs: it must run years from now on a club member's machine
 * with no toolchain in the way. It duplicates the parser deliberately —
 * lib/roster/parse.ts is the tested one used by the dashboard upload; this
 * is the terminal fallback for when there is no dashboard yet.
 */
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const args = process.argv.slice(2);
const production = args.includes("--production");
const path = args.find((a) => !a.startsWith("--"));

if (!path) {
  console.error('Usage: npm run load-roster -- "path/to/roster.csv" [--production]');
  process.exit(1);
}

function parseCsv(text) {
  const input = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;

  while (i < input.length) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; }
    else if (c === ",") { row.push(field); field = ""; i += 1; }
    else if (c === "\r" && input[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 2; }
    else if (c === "\n" || c === "\r") { row.push(field); rows.push(row); row = []; field = ""; i += 1; }
    else { field += c; i += 1; }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function parseRoster(text) {
  const grid = parseCsv(text);
  const headerIndex = grid.findIndex(
    (r) => r.some((c) => /^name$/i.test(c.trim())) && r.some((c) => /e-?mail/i.test(c.trim())),
  );
  if (headerIndex === -1) throw new Error("No header row with Name and Email columns.");

  const header = grid[headerIndex];
  const groups = headerIndex > 0 ? grid[headerIndex - 1] : [];
  const pairs = [];

  for (let c = 0; c < header.length - 1; c++) {
    if (!/^name$/i.test(header[c].trim())) continue;
    if (!/e-?mail/i.test(header[c + 1].trim())) continue;
    const year = /\((\d{4})\)/.exec(groups[c] ?? "")?.[1];
    pairs.push({ nameAt: c, emailAt: c + 1, classYear: year ? Number(year) : null });
  }

  const rows = [], errors = [], seen = new Set();

  for (let r = headerIndex + 1; r < grid.length; r++) {
    for (const pair of pairs) {
      const fullName = (grid[r][pair.nameAt] ?? "").trim();
      const email = (grid[r][pair.emailAt] ?? "").trim();
      if (!fullName && !email) continue;
      if (!fullName || !email) { errors.push(`Row ${r + 1}: incomplete entry.`); continue; }

      const netid = email.split("@")[0].trim().toLowerCase();
      if (!/^[a-z][a-z0-9]{1,15}$/.test(netid)) {
        errors.push(`Row ${r + 1}: "${email}" is not a Princeton address.`);
        continue;
      }
      if (seen.has(netid)) { errors.push(`Row ${r + 1}: ${netid} appears twice.`); continue; }

      seen.add(netid);
      rows.push({ netid, full_name: fullName, class_year: pair.classYear });
    }
  }
  return { rows, errors };
}

const { rows, errors } = parseRoster(readFileSync(path, "utf8"));

if (errors.length) {
  console.error("Problems found — nothing was written:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

if (rows.length === 0) {
  console.error("No members in that file. Refusing to treat it as 'remove everyone'.");
  process.exit(1);
}

const url = production
  ? process.env.PRODUCTION_SUPABASE_URL
  : process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = production
  ? process.env.PRODUCTION_SERVICE_ROLE_KEY
  : process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    production
      ? "Set PRODUCTION_SUPABASE_URL and PRODUCTION_SERVICE_ROLE_KEY in .env.local"
      : "Missing local Supabase credentials in .env.local",
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { error } = await db.from("people").upsert(
  rows.map((r) => ({ ...r, is_member: true, home_club: "Cap & Gown" })),
  { onConflict: "netid" },
);

if (error) {
  console.error(error.message);
  process.exit(1);
}

// Tablets pick the new roster up on their next sync.
const { data: version } = await db.from("versions").select("version").eq("resource", "roster").single();
await db.from("versions").update({ version: (version?.version ?? 1) + 1 }).eq("resource", "roster");

const { count } = await db
  .from("people").select("*", { count: "exact", head: true }).eq("is_member", true);

const byYear = rows.reduce((acc, r) => ((acc[r.class_year ?? "unknown"] = (acc[r.class_year ?? "unknown"] ?? 0) + 1), acc), {});

console.log(`Loaded ${rows.length} members into ${production ? "PRODUCTION" : "local"}.`);
console.log("By class year:", byYear);
console.log(`Active members in the database now: ${count}`);
