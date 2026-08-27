import { expect, test } from "@playwright/test";

const resources = [
    { path: "companies", heading: "Companies", field: "Name", noun: "company" },
    { path: "people", heading: "People", field: "Name", noun: "person" },
    { path: "opportunities", heading: "Opportunities", field: "Name", noun: "opportunity" },
    { path: "tasks", heading: "Tasks", field: "Title", noun: "task" },
    { path: "notes", heading: "Notes", field: "Title", noun: "note" },
] as const;

test.beforeEach(async ({ page }) => {
    test.skip(
        process.env.E2E_DATABASE !== "true",
        "Requires the migrated and seeded E2E database.",
    );

    await page.goto("/app/login");
    await page.getByLabel("Email address").fill("ada@example.test");
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(page).toHaveURL(/\/app\/analytical-engines$/u);
});

for (const resource of resources) {
    test(`lists, creates, and deletes ${resource.path}`, async ({ page }) => {
        const recordName = `E2E ${resource.noun} ${Date.now()}`;

        await page.goto(`/app/analytical-engines/${resource.path}`);
        await expect(page.getByRole("heading", { level: 1, name: resource.heading })).toBeVisible();

        await page.getByRole("button", { name: `New ${resource.noun}` }).click();
        await page.getByLabel(resource.field, { exact: true }).fill(recordName);
        await page.getByRole("button", { name: `Add ${resource.noun}` }).click();

        const recordLink = page.getByRole("link", { name: recordName });
        await expect(recordLink).toBeVisible();
        await expect(page.getByRole("status")).toHaveText("Record created.");

        await page.getByRole("button", { name: `Delete ${recordName}` }).click();
        await expect(recordLink).toHaveCount(0);
    });
}

test("keeps CRM navigation usable on mobile @mobile", async ({ page }) => {
    await page.goto("/app/analytical-engines/companies");

    const mobileMenu = page.locator('summary[aria-label="Open navigation"]');
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await expect(page.getByRole("navigation", { name: "Workspace", exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole("link", { name: "Notes" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/app\/analytical-engines\/notes$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
});
