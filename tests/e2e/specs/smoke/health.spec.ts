import { expect, test } from "@playwright/test";

test("serves the Node application without browser errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto("/up");

    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toHaveText("OK");
    expect(errors).toEqual([]);
});
