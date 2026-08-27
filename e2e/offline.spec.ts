import { test, expect, type Page } from "@playwright/test";
import { serviceClient } from "../lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "../lib/auth/device";

const db = serviceClient();

const DEVICE = "e2etest-lane";
const PERIOD = "e2e-always-open";
/**
 * `card` is the 15-digit base that gets bound; `swipe` is what the reader
 * actually emits — both tracks, with the holder's name between them. A bare
 * number is NOT a card: without track sentinels the parser treats it as a
 * typed identifier and takes the netID path instead.
 */
const PEOPLE = [
  { netid: "e2eaaa01", full_name: "Alice Offline", card: "100000000000001",
    swipe: "%100000000000001=ALICE/OFFLINE?;1000000000000018700=?" },
  { netid: "e2ebbb02", full_name: "Bob Offline", card: "100000000000002",
    swipe: "%100000000000002=BOB/OFFLINE?;1000000000000028700=?" },
  { netid: "e2eccc03", full_name: "Carol Offline", card: "100000000000003",
    swipe: "%100000000000003=CAROL/OFFLINE?;1000000000000038700=?" },
];
/** Known to the roster, but with no card bound — the offline member path. */
const UNBOUND = {
  netid: "e2eddd04", full_name: "Dave Unbound", card: "100000000000004",
  swipe: "%100000000000004=DAVE/UNBOUND?;1000000000000048700=?",
};
const NETIDS = [...PEOPLE.map((p) => p.netid), UNBOUND.netid];

/**
 * Today's weekday IN THE CLUB'S TIMEZONE.
 *
 * Not `new Date().getDay()`, which reads the machine's own zone. A developer
 * on Pacific time at 23:00 is still on Tuesday while New York is already on
 * Wednesday, so the fixture would install its window on the wrong day and
 * every scan would find no meal. This has already happened once.
 */
function clubWeekday(): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

test.beforeEach(async () => {
  await db.from("meal_schedule").upsert({
    day_of_week: clubWeekday(),
    period_name: PERIOD,
    start_time: "00:00:00",
    end_time: "23:59:59",
    grace_minutes: 0,
  });

  await db.from("people").upsert([
    ...PEOPLE.map((p) => ({
      netid: p.netid, full_name: p.full_name,
      is_member: true, home_club: "Cap & Gown",
    })),
    {
      netid: UNBOUND.netid, full_name: UNBOUND.full_name,
      is_member: true, home_club: "Cap & Gown",
    },
  ]);

  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("credentials").delete().in("netid", NETIDS);
  await db.from("credentials").upsert(
    PEOPLE.map((p) => ({ token: p.card, netid: p.netid })),
  );
});

test.afterEach(async () => {
  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("credentials").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);
  await db.from("meal_schedule").delete().eq("period_name", PERIOD);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("swipes").delete().in("station_id", ids);
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

/**
 * Type a swipe at reader speed, terminated by Enter, as a keyboard wedge does.
 *
 * `type` rather than per-character `press`: a stripe carries %, ;, = and ?,
 * and press() reads some of those as key NAMES rather than characters.
 */
async function scanCard(page: Page, swipe: string) {
  await page.keyboard.type(swipe, { delay: 2 });
  await page.keyboard.press("Enter");
}

/** Enrol the browser, load the station, and wait for the cache to be warm. */
async function warmStation(page: Page) {
  const { code } = await createEnrollmentCode(DEVICE);
  const enrolled = (await redeemEnrollmentCode(code))!;

  await page.goto("/station");
  await page.evaluate((t) => localStorage.setItem("deviceToken", t), enrolled.token);
  await page.reload();

  await expect(page.getByTestId("idle")).toBeVisible({ timeout: 15_000 });
  return enrolled;
}

const swipeCount = async (netid: string) => {
  const { count } = await db
    .from("swipes").select("*", { count: "exact", head: true }).eq("netid", netid);
  return count ?? 0;
};

test("1. a known card checks in with the network off, touching no network at all", async ({
  page,
  context,
}) => {
  await warmStation(page);

  const attempted: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) attempted.push(r.url());
  });

  await context.setOffline(true);
  attempted.length = 0;

  await scanCard(page, PEOPLE[0].swipe);

  await expect(page.getByTestId("name")).toHaveText("Alice Offline");
  await expect(page.getByTestId("checked-in")).toBeVisible();

  // The 500ms budget rests on this: a cached token never asks anybody.
  expect(attempted.filter((u) => u.includes("/api/resolve"))).toEqual([]);
});

test("2. the failure drill — scans made offline upload themselves when the network returns", async ({
  page,
  context,
}) => {
  // The claim the entire architecture exists to support. On 2026-08-30 there
  // is one chance to check this by hand; here it runs every time.
  await warmStation(page);
  await context.setOffline(true);

  for (const person of PEOPLE) {
    await scanCard(page, person.swipe);
    await expect(page.getByTestId("name")).toHaveText(person.full_name);
  }

  await expect(page.getByTestId("unsynced")).toBeVisible({ timeout: 10_000 });
  for (const person of PEOPLE) expect(await swipeCount(person.netid)).toBe(0);

  await context.setOffline(false);

  // Nobody touches anything. The background loop drains on its own.
  for (const person of PEOPLE) {
    await expect
      .poll(() => swipeCount(person.netid), { timeout: 20_000 })
      .toBe(1);
  }
});

test("3. an unknown card offline is confirmed from its printed name and syncs later", async ({
  page,
  context,
}) => {
  await warmStation(page);
  await context.setOffline(true);

  await scanCard(page, UNBOUND.swipe);

  // The card names them and the roster is already on the tablet, so the whole
  // match runs with no network at all.
  await expect(page.getByTestId("candidates")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(UNBOUND.netid) }).click();
  await expect(page.getByTestId("name")).toHaveText(UNBOUND.full_name);

  await context.setOffline(false);

  await expect.poll(() => swipeCount(UNBOUND.netid), { timeout: 20_000 }).toBe(1);

  await expect
    .poll(async () => {
      const { data } = await db
        .from("credentials").select("netid").eq("token", UNBOUND.card).maybeSingle();
      return data?.netid ?? null;
    }, { timeout: 20_000 })
    .toBe(UNBOUND.netid);
});

test("4. the cache survives a restart", async ({ page, context }) => {
  // Photo blobs are covered by the store and bootstrap unit tests; there is
  // no upload path to serve real headshots from yet. What matters here is
  // that the roster, the token map and the schedule persist across a restart,
  // so a tablet rebooted mid-service comes back serving.
  await warmStation(page);

  await page.reload();
  await expect(page.getByTestId("idle")).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);

  await scanCard(page, PEOPLE[1].swipe);
  await expect(page.getByTestId("name")).toHaveText("Bob Offline");
});

test("5. the app loads at all after a reload with the network off", async ({
  page,
  context,
}) => {
  // The gap that prompted the service worker, found 2026-08-17. IndexedDB
  // held everything needed to serve a meal, but the app shell was fetched
  // over the network — so reloading a tablet during an outage showed a
  // browser error and the warm cache was unreachable.
  await warmStation(page);

  // Wait for the worker to actually CONTROL the page. A worker that has
  // registered but not yet taken over intercepts nothing, and the test would
  // fail for the wrong reason.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 15_000,
  });

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByTestId("idle")).toBeVisible({ timeout: 15_000 });

  // And it is genuinely working, not merely rendering.
  await scanCard(page, PEOPLE[2].swipe);
  await expect(page.getByTestId("name")).toHaveText("Carol Offline");
});
