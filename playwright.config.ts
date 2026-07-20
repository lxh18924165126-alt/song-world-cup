import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
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
      command: "pnpm db:migrate:local && pnpm db:seed:e2e && pnpm --filter @song-world-cup/api dev",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @song-world-cup/web build && pnpm --filter @song-world-cup/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
