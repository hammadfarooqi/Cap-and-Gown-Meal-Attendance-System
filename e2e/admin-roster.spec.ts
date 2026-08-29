import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DOMAIN = "@e2eroster.invalid";
const OFFICER = `officer${DOMAIN}`;
const PASSWORD = "a good long password";
const NETIDS = ["ro9001", "ro9002", "ro9003"];

const csv = (people: [string, string][]) =>
  ["Juniors (2028),", "Name,Email Address", ...people.map(([n, e]) => `${n},${e}@princeton.edu`)].join("\n");

/**
 * A roster diff is global by definition — it compares an upload against every
 * member there is — so these tests have to own the table while they run.
 *
 * Real members are parked by clearing is_member, never deleted: their swipes
 * reference them, and afterEach puts every one of them back. Playwright runs
 * afterEach even when a test fails, so a crash mid-test still restores.
 */
let parked: string[] = [];

async function parkRealMembers() {
  const { data } = await db
    .from("people").select("netid").eq("is_member", true).not("netid", "in", `(${NETIDS.join(",")})`);

  parked = (data ?? []).map((p) => p.netid);
  if (parked.length > 0) {
    await db.from("people").update({ is_member: false }).in("netid", parked);
  }
}

async function restoreRealMembers() {
  if (parked.length > 0) {
    await db.from("people").update({ is_member: true, home_club: "Cap & Gown" }).in("netid", parked);
    parked = [];
  }
}

async function purge() {
  await db.from("swipes").delete().in("netid", NETIDS);
  await db.from("credentials").delete().in("netid", NETIDS);
  await db.from("people").delete().in("netid", NETIDS);

  const { data } = await db.auth.admin.listUsers();
  for (const user of data.users) {
    if (user.email?.endsWith(DOMAIN)) {
      await db.from("admins").delete().eq("user_id", user.id);
      await db.auth.admin.deleteUser(user.id).catch(() => {});
    }
  }
}

test.beforeEach(async () => {
  await purge();
  await parkRealMembers();
  const officer = await db.auth.admin.createUser({
    email: OFFICER, password: PASSWORD, email_confirm: true,
  });
  await db.from("admins").insert({ user_id: officer.data.user!.id, email: OFFICER });

  await db.from("people").insert(NETIDS.map((netid, i) => ({
    netid, full_name: `Roster Person ${i}`, is_member: true,
    class_year: 2028, home_club: "Cap & Gown",
  })));
});

test.afterEach(async () => {
  await restoreRealMembers();
  await purge();
});

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OFFICER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/roster");
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
}

const upload = (page: Page, name: string, body: string) =>
  page.getByLabel("Membership spreadsheet").setInputFiles({
    name, mimeType: "text/csv", buffer: Buffer.from(body),
  });

const isMember = async (netid: string) => {
  const { data } = await db.from("people").select("is_member").eq("netid", netid).single();
  return data!.is_member;
};

test("an upload changes nothing until it is confirmed", async ({ page }) => {
  await signIn(page);

  // Everyone who is already a member, plus one newcomer — otherwise this
  // file would itself be a mass removal, which the guard rightly blocks.
  await upload(page, "roster.csv", csv([
    ["Roster Person 0", "ro9001"],
    ["Roster Person 1", "ro9002"],
    ["Roster Person 2", "ro9003"],
    ["Brand New", "ro9099"],
  ]));
  await expect(page.getByTestId("diff-add")).toHaveText("1");
  await expect(page.getByTestId("diff-drop")).toHaveText("0");

  // The preview is on screen. Nothing has been written.
  const { data } = await db.from("people").select("netid").eq("netid", "ro9099");
  expect(data).toHaveLength(0);

  await page.getByRole("button", { name: "Apply these changes" }).click();
  await expect(page.getByRole("status")).toContainText("1 added");

  await expect.poll(async () => {
    const { data: after } = await db.from("people").select("netid").eq("netid", "ro9099");
    return after?.length ?? 0;
  }).toBe(1);

  await db.from("people").delete().eq("netid", "ro9099");
});

test("A TRUNCATED FILE CANNOT SILENTLY EMPTY THE CLUB", async ({ page }) => {
  // The realistic accident: an export cut short. It reads as "remove
  // everyone", and these are people who still have meals to eat.
  await signIn(page);

  await upload(page, "truncated.csv", csv([["Roster Person 0", "ro9001"]]));

  await expect(page.getByTestId("diff-drop")).toHaveText("2");
  await expect(page.getByTestId("large-drop-warning")).toContainText("removes 2 of");

  // The apply button is refused until the warning is acknowledged.
  await expect(page.getByRole("button", { name: "Apply these changes" })).toBeDisabled();

  await page.getByLabel("I have checked the file and this is right").check();
  await expect(page.getByRole("button", { name: "Apply these changes" })).toBeEnabled();
});

test("a departure sets is_member false and never deletes the row", async ({ page }) => {
  await signIn(page);

  await upload(page, "roster.csv", csv([
    ["Roster Person 0", "ro9001"],
    ["Roster Person 1", "ro9002"],
  ]));

  await expect(page.getByTestId("diff-drop")).toHaveText("1");
  await page.getByRole("button", { name: "Apply these changes" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await expect.poll(() => isMember("ro9003")).toBe(false);

  // The row survives, so their swipe history stays attached and they can
  // still eat here as somebody's guest.
  const { data } = await db.from("people").select("netid, home_club").eq("netid", "ro9003").single();
  expect(data!.netid).toBe("ro9003");
  expect(data!.home_club).toBe("None");
});

test("a bad file is rejected with reasons, and writes nothing", async ({ page }) => {
  await signIn(page);

  await upload(page, "bad.csv", "Name,Email Address\nBroken Person,not-an-address");

  const errors = page.getByTestId("upload-errors");
  await expect(errors).toContainText("Nothing was changed");
  await expect(errors).toContainText("Row 2");
  expect(await isMember("ro9001")).toBe(true);
});

test("one person can be removed by hand", async ({ page }) => {
  await signIn(page);
  page.on("dialog", (d) => d.accept());

  await page.getByRole("row", { name: /Roster Person 1/ })
    .getByRole("button", { name: "Remove" }).click();

  await expect.poll(() => isMember("ro9002")).toBe(false);
});
