/**
 * Open a temporary meal window so the station app can be exercised outside
 * real service hours. LOCAL ONLY.
 *
 *   npm run demo-window        # open one covering now
 *   npm run demo-window -- off # remove it
 *
 * It only ever opens a window inside a GAP between real meals. Two reasons:
 * an overlapping window makes deriveMeal's answer depend on row order, which
 * the schedule tests correctly refuse to allow; and if a real meal is already
 * running there is nothing to fake — use it.
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const PERIOD = "demo";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
  console.error("Refusing to run against anything but the local database.");
  process.exit(1);
}

const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (process.argv.includes("off")) {
  await db.from("meal_schedule").delete().eq("period_name", PERIOD);
  console.log("Demo window removed.");
  process.exit(0);
}

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date());
const get = (t) => parts.find((p) => p.type === t).value;

const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
const nowMinutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));

await db.from("meal_schedule").delete().eq("period_name", PERIOD);

const { data: windows } = await db
  .from("meal_schedule")
  .select("period_name, start_time, end_time, grace_minutes")
  .eq("day_of_week", day);

const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const busy = (windows ?? []).map((w) => ({
  name: w.period_name,
  from: toMinutes(w.start_time) - w.grace_minutes,
  to: toMinutes(w.end_time) + w.grace_minutes,
}));

const running = busy.find((w) => nowMinutes >= w.from && nowMinutes <= w.to);
if (running) {
  console.log(`"${running.name}" is running right now — no demo window needed.`);
  process.exit(0);
}

// The widest gap around now that touches no real window.
const start = Math.max(0, ...busy.filter((w) => w.to < nowMinutes).map((w) => w.to + 1));
const end = Math.min(1439, ...busy.filter((w) => w.from > nowMinutes).map((w) => w.from - 1));

const pad = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

const { error } = await db.from("meal_schedule").insert({
  day_of_week: day,
  period_name: PERIOD,
  start_time: pad(start),
  end_time: pad(end),
  grace_minutes: 0,
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Demo window open ${pad(start)}–${pad(end)} New York time (today only).`);
console.log('Remove it with: npm run demo-window -- off');
