import { test, expect } from "@playwright/test";
import { serviceClient } from "../lib/db/client";
import { createEnrollmentCode, redeemEnrollmentCode } from "../lib/auth/device";

const db = serviceClient();

const CARD = "98765432109876";
const NETID = "e2e00001";
const DEVICE = "e2etest-lane";
const PERIOD = "e2e-always-open";

/**
 * Today's weekday IN THE CLUB'S TIMEZONE.
 *
 * Not `new Date().getDay()`, which reads the machine's own zone. A developer
 * on Pacific time at 23:00 is still on Tuesday while New York is already on
 * Wednesday, so the fixture would install its window on the wrong day and the
 * scan would find no meal. This is the same trap deriveMeal exists to avoid.
 */
function clubWeekday(): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

test.beforeEach(async () => {
  // A window that is open right now, whatever time this test runs. The meal
  // schedule itself is covered by deriveMeal's unit tests; here it only needs
  // to not be the reason the test fails.
  await db.from("meal_schedule").upsert({
    day_of_week: clubWeekday(),
    period_name: PERIOD,
    start_time: "00:00:00",
    end_time: "23:59:59",
    grace_minutes: 0,
  });
  await db.from("people").upsert({
    netid: NETID,
    full_name: "Skeleton Student",
    is_member: true,
    home_club: "Cap & Gown",
  });
  await db.from("credentials").upsert({ token: CARD, netid: NETID });
  await db.from("swipes").delete().eq("netid", NETID);
});

test.afterEach(async () => {
  await db.from("swipes").delete().eq("netid", NETID);
  await db.from("credentials").delete().eq("netid", NETID);
  await db.from("people").delete().eq("netid", NETID);
  await db.from("meal_schedule").delete().eq("period_name", PERIOD);

  const { data } = await db.from("devices").select("id").eq("name", DEVICE);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("swipes").delete().in("station_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
});

/** Type at reader speed and terminate with Enter, as a keyboard wedge does. */
async function scanCard(page: import("@playwright/test").Page, card: string) {
  for (const ch of card) {
    await page.keyboard.press(ch, { delay: 2 });
  }
  await page.keyboard.press("Enter");
}

test("a card burst produces a name on screen and a row in Postgres", async ({ page }) => {
  const { code } = await createEnrollmentCode(DEVICE);
  const enrolled = await redeemEnrollmentCode(code);

  await page.goto("/station");
  await page.evaluate((t) => localStorage.setItem("deviceToken", t), enrolled!.token);
  await page.reload();

  await expect(page.getByTestId("idle")).toBeVisible();

  await scanCard(page, CARD);

  await expect(page.getByTestId("name")).toHaveText("Skeleton Student");
  await expect(page.getByTestId("checked-in")).toBeVisible();

  const { data } = await db.from("swipes").select("*").eq("netid", NETID).single();
  expect(data).not.toBeNull();
  expect(data!.entry_method).toBe("scan");
  expect(data!.station_id).toBe(enrolled!.deviceId);
});

test("an unenrolled browser cannot check anyone in", async ({ page }) => {
  // Someone finds the URL and opens it on their phone. The page loads,
  // because it is public client-side code. It must still be unable to write.
  await page.goto("/station");
  await expect(page.getByTestId("idle")).toBeVisible();

  await scanCard(page, CARD);

  await expect(page.getByTestId("failed")).toBeVisible();

  const { count } = await db
    .from("swipes")
    .select("*", { count: "exact", head: true })
    .eq("netid", NETID);
  expect(count).toBe(0);
});
