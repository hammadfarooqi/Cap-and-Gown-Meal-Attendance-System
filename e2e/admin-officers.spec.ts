import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DOMAIN = "@e2eofficer.invalid";
const OFFICER = `chair${DOMAIN}`;
const PASSWORD = "a good long password";

/** These tests count officers, so they must own the table while they run. */
let parked: { user_id: string; email: string; added_at: string; added_by: string | null }[] = [];

async function purge() {
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

  const { data: others } = await db.from("admins").select("*").not("email", "like", `%${DOMAIN}`);
  parked = others ?? [];
  if (parked.length > 0) {
    await db.from("admins").delete().not("email", "like", `%${DOMAIN}`);
  }

  const chair = await db.auth.admin.createUser({
    email: OFFICER, password: PASSWORD, email_confirm: true,
  });
  await db.from("admins").insert({ user_id: chair.data.user!.id, email: OFFICER });
});

test.afterEach(async () => {
  await purge();
  if (parked.length > 0) {
    await db.from("admins").upsert(parked);
    parked = [];
  }
});

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OFFICER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/admins");
  await expect(page.getByRole("heading", { name: "Officers" })).toBeVisible();
}

test("AN OFFICER CAN ADD ANOTHER OFFICER, with no developer involved", async ({ page }) => {
  // The whole "never wait on a developer" promise rests on this page.
  await signIn(page);

  await page.getByLabel("Officer email").fill(`treasurer${DOMAIN}`);
  await page.getByLabel("Officer password").fill("another good password");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByRole("status")).toContainText("can now sign in");
  await expect(page.getByRole("cell", { name: `treasurer${DOMAIN}` })).toBeVisible();
});

test("the new officer can actually sign in", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Officer email").fill(`treasurer${DOMAIN}`);
  await page.getByLabel("Officer password").fill("another good password");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.getByLabel("Email").fill(`treasurer${DOMAIN}`);
  await page.getByLabel("Password").fill("another good password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);
});

test("a short password is refused, with the reason", async ({ page }) => {
  await signIn(page);

  await page.getByLabel("Officer email").fill(`weak${DOMAIN}`);
  await page.getByLabel("Officer password").fill("short");

  // The button stays disabled rather than failing after the fact.
  await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
});

test("THE LAST OFFICER CANNOT REMOVE THEMSELVES", async ({ page }) => {
  // Locking every officer out of a live system cannot be undone from inside
  // the dashboard, which is exactly the developer-dependency this avoids.
  await signIn(page);
  page.on("dialog", (d) => d.accept());

  await page.getByRole("row", { name: new RegExp(OFFICER) })
    .getByRole("button", { name: "Remove" }).click();

  await expect(page.getByTestId("admin-error")).toContainText("cannot remove the last officer");
  await expect(page.getByRole("cell", { name: OFFICER })).toBeVisible();
});

test("an officer who has left loses access immediately", async ({ page }) => {
  await signIn(page);
  page.on("dialog", (d) => d.accept());

  await page.getByLabel("Officer email").fill(`leaver${DOMAIN}`);
  await page.getByLabel("Officer password").fill("graduating in june");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("cell", { name: `leaver${DOMAIN}` })).toBeVisible();

  await page.getByRole("row", { name: new RegExp(`leaver${DOMAIN}`) })
    .getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("cell", { name: `leaver${DOMAIN}` })).not.toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.getByLabel("Email").fill(`leaver${DOMAIN}`);
  await page.getByLabel("Password").fill("graduating in june");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("the bare address goes to the dashboard, not a framework splash", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/admin(\/login)?$/);
});
