import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
    testDir: "./tests/e2e/specs",
    outputDir: "./test-results/playwright",
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
        ? [
              ["line"],
              ["html", { open: "never", outputFolder: "playwright-report" }],
              ["junit", { outputFile: "test-results/e2e.xml" }],
          ]
        : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL,
        locale: "en-US",
        timezoneId: "UTC",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: {
        command: process.env.CI
            ? "npm run start -- --hostname 127.0.0.1 --port 3100"
            : "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: `${baseURL}/up`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "mobile-chromium",
            grep: /@mobile/u,
            use: { ...devices["Pixel 7"] },
        },
    ],
});
