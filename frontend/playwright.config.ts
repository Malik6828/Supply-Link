import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  // Run once before all API tests to issue the auditor key
  globalSetup: './e2e/api/globalSetup.ts',

  projects: [
    // ── Browser projects ──────────────────────────────────────────────────────
    {
      name: 'chromium',
      testMatch: /e2e\/(?!api\/).*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /e2e\/(?!api\/).*\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /e2e\/(?!api\/).*\.spec\.ts$/,
      use: { ...devices['Desktop Safari'] },
    },

    // ── API-only project ──────────────────────────────────────────────────────
    // No browser; tests use the `request` fixture exclusively.
    {
      name: 'api',
      testMatch: /e2e\/api\/.*\.spec\.ts$/,
      use: {
        baseURL: process.env.API_BASE_URL ?? 'http://localhost:3000',
        extraHTTPHeaders: {},
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Inject the test API keys into the server process so auth.ts can validate them.
    env: {
      PARTNER_API_KEY: process.env.PARTNER_API_KEY ?? 'test-partner-key-e2e',
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? 'test-internal-key-e2e',
      TRUSTED_PROXY: 'true',
    },
  },
});
