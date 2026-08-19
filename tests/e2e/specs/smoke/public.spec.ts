import { expect, test } from "@playwright/test";

test("renders the public product page @mobile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");

    await expect(
        page.getByRole("heading", {
            level: 1,
            name: "The CRM for work that starts with a conversation.",
        }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        "/app/login",
    );
    expect(errors).toEqual([]);
});

test("serves the historical public pages with shared navigation", async ({ page }) => {
    const routes = [
        ["/terms-of-service", "Terms of Service"], ["/privacy-policy", "Privacy Policy"],
        ["/press", "Press Kit & Facts"], ["/compare/relaticle-vs-twenty", "Relaticle vs Twenty"],
        ["/compare/relaticle-vs-espocrm", "Relaticle vs EspoCRM"], ["/alternatives/attio", "Attio Alternative"],
        ["/alternatives/hubspot", "HubSpot Alternative"],
    ] as const;
    for (const [route, heading] of routes) {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole("link", { name: "Relaticle home" })).toBeVisible();
        await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    }
});

test("submits the protected contact form @mobile", async ({ page }) => {
    await page.goto("/contact");
    await page.getByLabel("Name").fill("Jane Doe");
    await page.getByLabel("Work email").fill("jane@example.com");
    await page.getByLabel("Company").fill("Acme");
    await page.getByLabel("How can we help?").fill("We would like to discuss a larger deployment.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("heading", { name: "Message sent" })).toBeVisible();
});

test("keeps legacy redirects to one hop", async ({ request }) => {
    const cases = [["/login", "/app/login"], ["/register", "/app/register"], ["/forgot-password", "/app/password-reset/request"], ["/docs/import", "/help/import"]] as const;
    for (const [source, destination] of cases) {
        const response = await request.get(source, { maxRedirects: 0 });
        expect([301, 302]).toContain(response.status());
        expect(new URL(response.headers().location ?? "http://invalid").pathname).toBe(destination);
    }
});

test("renders an accessible login form @mobile", async ({ page }) => {
    await page.goto("/app/login");

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to workspace" })).toBeVisible();
});
