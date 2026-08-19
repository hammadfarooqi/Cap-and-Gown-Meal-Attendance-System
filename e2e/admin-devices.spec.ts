import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DOMAIN = "@e2edevices.invalid";
const OFFICER = `officer${DOMAIN}`;
const PASSWORD = "a good long password";
const LANE = "e2edevices-Lane 1";

async function purge() {
  const { data: users } = await db.auth.admin.listUsers();
  for (const user of users.users) {
    if (user.email?.endsWith(DOMAIN)) {
      await db.from("admins").delete().eq("user_id", user.id);
      await db.auth.admin.deleteUser(user.id).catch(() => {});
    }
  }

  const { data: devices } = await db.from("devices").select("id").like("name", "e2edevices-%");
  const ids = (devices ?? []).map((d) => d.id);
  if (ids.length) {
    await db.from("swipes").delete().in("station_id", ids);
    await db.from("enrollment_codes").delete().in("device_id", ids);
    await db.from("devices").delete().in("id", ids);
  }
  await db.from("enrollment_codes").delete().like("name", "e2edevices-%");
}

test.beforeEach(async () => {
  await purge();
  const officer = await db.auth.admin.createUser({
    email: OFFICER, password: PASSWORD, email_confirm: true,
  });
  await db.from("admins").insert({ user_id: officer.data.user!.id, email: OFFICER });
});

test.afterEach(purge);

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OFFICER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("an officer can set up a tablet end to end, with no console needed", async ({ page }) => {
  // This is what replaces the localStorage hack the README documented.
  await signIn(page);
  await page.goto("/admin/devices");

  await page.getByLabel("Tablet name").fill(LANE);
  await page.getByRole("button", { name: "Get a code" }).click();

  const code = await page.getByTestId("enrollment-code").textContent();
  expect(code?.trim()).toMatch(/^[A-Z2-9]{8}$/);

  // Redeem it the way the tablet's enrolment screen does.
  const enrolled = await page.evaluate(async (c) => {
    const res = await fetch("/api/devices/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: c }),
    });
    return res.ok ? await res.json() : null;
  }, code!.trim());

  expect(enrolled?.token).toBeTruthy();

  // And that token actually works against a station endpoint.
  const status = await page.evaluate(async (t) => {
    const res = await fetch("/api/bootstrap", { headers: { authorization: `Bearer ${t}` } });
    return res.status;
  }, enrolled.token);

  expect(status).toBe(200);
});

test("revoking a tablet stops its token working, and keeps the row", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/devices");

  await page.getByLabel("Tablet name").fill(LANE);
  await page.getByRole("button", { name: "Get a code" }).click();
  const code = (await page.getByTestId("enrollment-code").textContent())!.trim();

  const enrolled = await page.evaluate(async (c) => {
    const res = await fetch("/api/devices/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: c }),
    });
    return await res.json();
  }, code);

  // The device row only exists once the code is redeemed, which happened
  // outside this page's knowledge.
  await page.reload();

  // Scope to this test's own row. The table lists every tablet the club has
  // ever set up, so an unscoped "Revoke" could belong to somebody else.
  const row = page.getByRole("row").filter({ hasText: LANE });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText("revoked")).toBeVisible();

  const status = await page.evaluate(async (t) => {
    const res = await fetch("/api/bootstrap", { headers: { authorization: `Bearer ${t}` } });
    return res.status;
  }, enrolled.token);

  expect(status).toBe(401);

  // The row survives. Swipes reference station_id, and deleting the device
  // would orphan every scan that lane ever took.
  const { data } = await db.from("devices").select("id, revoked_at").eq("name", LANE).single();
  expect(data!.revoked_at).not.toBeNull();
});

test("the device list is not reachable without signing in", async ({ page }) => {
  await page.goto("/admin/devices");
  await expect(page).toHaveURL(/\/admin\/login$/);

  // The API must REFUSE, not redirect. A redirecting API answers an
  // unauthenticated fetch with a 307 to the login page, which the browser
  // follows and reports as a perfectly good 200 — so a caller cannot tell
  // refusal from success.
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/admin/devices");
    return res.status;
  });
  expect(status).toBe(401);
});
