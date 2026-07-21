import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:14173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: [
    {
      command: "pnpm db:migrate:local && pnpm db:seed:e2e && pnpm --filter @song-world-cup/api exec wrangler dev --port 18787 --var ADMIN_TOKEN:local-admin-token",
      url: "http://127.0.0.1:18787/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "set VITE_API_PROXY_TARGET=http://127.0.0.1:18787&& pnpm --filter @song-world-cup/web build && pnpm --filter @song-world-cup/web exec vite preview --host 127.0.0.1 --port 14173 --strictPort",
      url: "http://127.0.0.1:14173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
