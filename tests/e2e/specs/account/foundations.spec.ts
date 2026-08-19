import { expect, test } from "@playwright/test";

test("exposes registration and recovery foundations", async ({ page }) => {
    await page.goto("/app/register");
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();

    await page.goto("/app/password-reset/request");
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();

    await page.goto("/app/verify-email");
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
});

test("rejects cross-origin browser mutations before authentication", async ({ request }) => {
    const response = await request.post("/auth/workspaces", {
        headers: { origin: "https://attacker.example" },
        form: { name: "Unauthorized workspace" },
        maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(await response.text()).toBe("Invalid request origin.");
});

test("requires a browser session for account and onboarding pages", async ({ page }) => {
    await page.goto("/app/settings/profile");
    await expect(page).toHaveURL(/\/app\/login$/u);
    await page.goto("/app/new");
    await expect(page).toHaveURL(/\/app\/login$/u);
});
