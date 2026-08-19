import { expect, test } from "@playwright/test";

test("signs in with a Node-owned database session", async ({ page }) => {
    test.skip(process.env.E2E_DATABASE !== "true", "Requires the migrated E2E database.");

    await page.goto("/app/login");
    await page.getByLabel("Email address").fill("ada@example.test");
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();

    await expect(page).toHaveURL(/\/app\/analytical-engines$/u);
    await expect(page.getByRole("heading", { name: "Good to see you, Ada." })).toBeVisible();
    await expect(page.getByText("Analytical Engines", { exact: true })).toBeVisible();
});
