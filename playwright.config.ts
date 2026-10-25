import { defineConfig, devices } from "@playwright/test";
// Explicit loopback exceptions also work in environments with a system proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"]
  .filter(Boolean)
  .join(",");
process.env.no_proxy = process.env.NO_PROXY;
const externalURL = process.env.LIFEPILOT_E2E_URL;
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/cloud",
  fullyParallel: true,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder:
          process.env.LIFEPILOT_E2E_LOCAL === "1"
            ? "playwright-report/local"
            : "playwright-report/cloud",
      },
    ],
  ],
  use: {
    baseURL: externalURL ?? "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      testIgnore: ["**/readability.spec.ts", "**/zoom.spec.ts"],
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: externalURL
    ? undefined
    : {
        command: "npm run start -- --port 3210",
        env: { LIFEPILOT_MODE: "cloud" },
        url: "http://127.0.0.1:3210",
        reuseExistingServer: false,
        timeout: 60000,
      },
});
