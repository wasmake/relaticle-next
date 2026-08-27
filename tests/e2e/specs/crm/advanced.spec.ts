import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    test.skip(process.env.E2E_DATABASE !== "true", "Requires the migrated and seeded E2E database.");
    await page.goto("/app/login");
    await page.getByLabel("Email address").fill("ada@example.test");
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
});

test("opens, edits, trashes, and restores a record with its timeline", async ({ page }) => {
    const name = `Advanced company ${Date.now()}`;
    await page.goto("/app/analytical-engines/companies");
    await page.getByRole("button", { name: "New company" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Add company" }).click();
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Activity" })).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name", { exact: true }).fill(`${name} edited`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Changes saved.");
    await page.getByRole("link", { name: "Back to companies" }).click();
    await page.getByRole("button", { name: `Delete ${name} edited` }).click();
    await page.locator('summary[aria-label="Filter"]').click();
    await page.getByRole("link", { name: "Trashed records" }).click();
    await expect(page.getByText(`${name} edited`, { exact: true })).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: `${name} edited` }).getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status")).toHaveText("Record restored.");
});

test("supports keyboard search and advanced workspace settings", async ({ page }) => {
    await page.goto("/app/analytical-engines/companies");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Search workspace" })).toBeVisible();
    await page.getByLabel("Search companies, people, opportunities, tasks, and notes").fill("Analytical");
    await page.keyboard.press("Escape");
    await page.locator("aside details > summary").first().click();
    await page.getByRole("link", { name: "Custom fields" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Custom fields" })).toBeVisible();
    await page.locator("aside details > summary").first().click();
    await page.getByRole("link", { name: "API tokens" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "API tokens" })).toBeVisible();
});

test("exposes opportunity and task boards", async ({ page }) => {
    for (const resource of ["opportunities", "tasks"] as const) {
        await page.goto(`/app/analytical-engines/${resource}/board`);
        await expect(page.getByLabel(`${resource} board`, { exact: true })).toBeVisible();
    }
});
