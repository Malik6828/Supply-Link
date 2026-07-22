/**
 * Playwright globalSetup — runs once before all API tests.
 *
 * Responsibilities:
 *   1. Wait for the dev server to be ready.
 *   2. Issue an auditor-tier API key via POST /api/v1/api-keys (using the
 *      internal key that was injected into the server via playwright.config.ts).
 *   3. Write the issued key into process.env so fixtures can read it.
 *
 * Assumptions:
 *   - PARTNER_API_KEY is already available to the server as "test-partner-key-e2e"
 *     (injected by playwright.config.ts webServer.env).
 *   - INTERNAL_API_KEY is available to the server as "test-internal-key-e2e".
 *   - Both values are the same defaults this file uses unless overridden.
 */

import { request as makeRequest } from '@playwright/test';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? 'test-internal-key-e2e';

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctx = await makeRequest.newContext({ baseURL: url });
      const res = await ctx.get('/api/health');
      await ctx.dispose();
      if (res.status() < 500) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server at ${url} did not become ready within ${timeoutMs}ms`);
}

export default async function globalSetup(): Promise<void> {
  await waitForServer(BASE_URL);

  // Issue an auditor-tier key using the internal key.
  const ctx = await makeRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.post('/api/v1/api-keys', {
    headers: {
      'x-api-key': INTERNAL_KEY,
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    data: {
      name: 'e2e-auditor-key',
      tier: 'auditor',
      owner: 'e2e-test-suite',
      description: 'Ephemeral key for Playwright API e2e tests',
      expiresInDays: 1,
    },
  });

  if (res.status() !== 201) {
    const body = await res.text();
    throw new Error(
      `globalSetup: Failed to issue auditor key. Status=${res.status()} body=${body}`,
    );
  }

  const { key } = (await res.json()) as { key: string };
  if (!key || !key.startsWith('sl_auditor_')) {
    throw new Error(`globalSetup: Unexpected key format: ${key}`);
  }

  // Expose to the test runner process so fixtures can read it.
  process.env.E2E_AUDITOR_KEY = key;

  await ctx.dispose();
}
