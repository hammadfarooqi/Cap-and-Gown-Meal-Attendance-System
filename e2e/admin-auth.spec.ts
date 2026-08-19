import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DOMAIN = "@e2eadmin.invalid";
const OFFICER = `officer${DOMAIN}`;
const STRANGER = `stranger${DOMAIN}`;
const PASSWORD = "a good long password";

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

  // An officer: a real account, on the allowlist.
  const officer = await db.auth.admin.createUser({
    email: OFFICER, password: PASSWORD, email_confirm: true,
  });
  await db.from("admins").insert({ user_id: officer.data.user!.id, email: OFFICER });

  // A stranger: an equally real account, NOT on the allowlist.
  await db.auth.admin.createUser({
    email: STRANGER, password: PASSWORD, email_confirm: true,
  });
});

test.afterEach(purge);

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a signed-out visitor is sent to the login page, without looping", async ({ page }) => {
  // The loop is the real hazard here: /admin/login lived inside the guarded
  // layout at first, so requireAdmin redirected to a page that ran
  // requireAdmin again. The route group is what prevents it.
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("an officer on the allowlist gets in", async ({ page }) => {
  await signIn(page, OFFICER);

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("navigation")).toContainText(OFFICER);
});

test("A VALID ACCOUNT THAT IS NOT ON THE ALLOWLIST IS KEPT OUT", async ({ page }) => {
  // Authentication is not authorisation. This account signs in perfectly.
  await signIn(page, STRANGER);

  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a wrong password says nothing about whether the account exists", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OFFICER);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();

  const realAccount = await page.getByRole("alert").textContent();

  await page.getByLabel("Email").fill(`nobody${DOMAIN}`);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Identical wording, or the login page becomes a way to find out who is
  // on the club's board.
  await expect(page.getByRole("alert")).toHaveText(realAccount!);
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, OFFICER);
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
