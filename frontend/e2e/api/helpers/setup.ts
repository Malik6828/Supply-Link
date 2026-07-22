/**
 * Shared Playwright API-test fixtures.
 *
 * Extends the base `test` object with:
 *   - `apiKey`      — the PARTNER_API_KEY for products/events endpoints
 *   - `auditorKey`  — the auditor-tier key for attestations (issued by globalSetup)
 *   - `internalKey` — the INTERNAL_API_KEY for admin operations
 *   - `baseURL`     — the resolved server base URL
 *
 * Usage:
 *   import { test, expect } from '../helpers/setup';
 *   test('GET /api/v1/products', async ({ request, apiKey, baseURL }) => { ... });
 */

import { test as base, expect } from '@playwright/test';

export { expect };

/** Well-known test API keys — must match playwright.config.ts webServer.env */
export const PARTNER_KEY = process.env.PARTNER_API_KEY ?? 'test-partner-key-e2e';
export const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? 'test-internal-key-e2e';

/** Origin header value accepted by the CORS middleware */
export const ALLOWED_ORIGIN = 'http://localhost:3000';

/** Resolved base URL */
export const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

// ── Custom fixture types ──────────────────────────────────────────────────────

type ApiFixtures = {
  apiKey: string;
  auditorKey: string;
  internalKey: string;
};

// ── Extended test ─────────────────────────────────────────────────────────────

export const test = base.extend<ApiFixtures>({
  /**
   * Partner-tier key for products/events endpoints.
   * Auth is validated against PARTNER_API_KEY env var in the server process.
   */
  // eslint-disable-next-line no-empty-pattern
  apiKey: async ({}, use) => {
    await use(PARTNER_KEY);
  },

  /**
   * Auditor-tier key issued by globalSetup at the start of the test run.
   * Required for attestations endpoint (registry-based auth).
   */
  // eslint-disable-next-line no-empty-pattern
  auditorKey: async ({}, use) => {
    const key = process.env.E2E_AUDITOR_KEY;
    if (!key) {
      throw new Error(
        'E2E_AUDITOR_KEY is not set — ensure globalSetup ran and issued an auditor key.',
      );
    }
    await use(key);
  },

  /**
   * Internal-tier key for admin operations (issuing keys, listing keys).
   */
  // eslint-disable-next-line no-empty-pattern
  internalKey: async ({}, use) => {
    await use(INTERNAL_KEY);
  },
});
