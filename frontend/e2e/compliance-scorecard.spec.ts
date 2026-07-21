import { test, expect, type Page } from '@playwright/test';

/**
 * These dashboard-area pages (compliance scorecard, reports, observability)
 * sit behind AuthGuard, which blocks rendering until a wallet address is
 * present in the persisted zustand store. Seeding localStorage directly
 * (rather than driving the real Freighter connect flow) keeps these specs
 * fast and independent of wallet extension mocking.
 */
const TEST_WALLET = 'GTESTE2EWALLET0000000000000000000000000000000000000001';

const STORE_KEY = 'supply-link-store';

async function seedWallet(page: Page) {
  await page.addInitScript(
    ({ key, wallet }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ state: { walletAddress: wallet }, version: 0 }),
      );
    },
    { key: STORE_KEY, wallet: TEST_WALLET },
  );
}

/** Seeds a full harvest → processing → shipping → retail event chain for one product. */
async function seedAuditReportData(page: Page) {
  const now = Date.now();
  const products = [
    {
      id: 'e2e-audit-prod',
      name: 'E2E Traceability Coffee',
      origin: 'Test Origin',
      owner: TEST_WALLET,
      timestamp: now - 4 * 86_400_000,
      authorizedActors: [TEST_WALLET],
    },
  ];
  const events = [
    {
      productId: 'e2e-audit-prod',
      eventType: 'HARVEST',
      location: 'Test Farm',
      actor: TEST_WALLET,
      timestamp: now - 4 * 86_400_000,
      metadata: JSON.stringify({ notes: 'harvested' }),
    },
    {
      productId: 'e2e-audit-prod',
      eventType: 'PROCESSING',
      location: 'Test Factory',
      actor: TEST_WALLET,
      timestamp: now - 3 * 86_400_000,
      metadata: JSON.stringify({ notes: 'processed' }),
    },
    {
      productId: 'e2e-audit-prod',
      eventType: 'SHIPPING',
      location: 'Test Port',
      actor: TEST_WALLET,
      timestamp: now - 2 * 86_400_000,
      metadata: JSON.stringify({ notes: 'shipped' }),
    },
    {
      productId: 'e2e-audit-prod',
      eventType: 'RETAIL',
      location: 'Test Store',
      actor: TEST_WALLET,
      timestamp: now - 1 * 86_400_000,
      metadata: JSON.stringify({ notes: 'on shelf' }),
    },
  ];

  await page.addInitScript(
    ({ key, wallet, products, events }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ state: { walletAddress: wallet, products, events }, version: 0 }),
      );
    },
    { key: STORE_KEY, wallet: TEST_WALLET, products, events },
  );
}

test.describe('E2E: Compliance scorecard and audit reporting', () => {
  test('opens the compliance scorecard for a full event chain product and shows score + metrics', async ({
    page,
  }) => {
    await seedWallet(page);

    // prod-001 in the mock dataset has a complete HARVEST → PROCESSING →
    // SHIPPING → RETAIL chain across 3 distinct actors.
    await page.goto('/en/compliance/scorecard/prod-001');

    await expect(page.getByTestId('scorecard-overall-score')).toBeVisible();
    await expect(page.getByTestId('scorecard-grade')).toBeVisible();

    const scoreText = await page.getByTestId('scorecard-overall-score').innerText();
    expect(scoreText).toMatch(/\d{1,3}/);

    const gradeText = (await page.getByTestId('scorecard-grade').innerText()).trim();
    expect(['A', 'B', 'C', 'D', 'F']).toContain(gradeText);

    // A complete, well-ordered chain should score highly with full event coverage.
    await expect(page.getByText('Event Coverage')).toBeVisible();
    await expect(page.getByText('Compliance Adherence')).toBeVisible();
  });

  test('shows gap indicator recommendations for a product with incomplete traceability', async ({
    page,
  }) => {
    await seedWallet(page);

    // prod-002 only has a single HARVEST event recorded, so coverage of the
    // full supply-chain is incomplete and should surface a recommendation.
    await page.goto('/en/compliance/scorecard/prod-002');

    await expect(page.getByTestId('scorecard-overall-score')).toBeVisible();

    const gaps = page.getByTestId('scorecard-gaps');
    await expect(gaps).toBeVisible();
    await expect(gaps).toContainText(/coverage/i);
  });

  test('shows a not-found message for an unknown product id', async ({ page }) => {
    await seedWallet(page);

    await page.goto('/en/compliance/scorecard/does-not-exist');

    await expect(page.getByText(/Failed to load scorecard/i)).toBeVisible({ timeout: 10_000 });
  });

  test('generates an audit report and downloads a non-empty CSV artifact', async ({ page }) => {
    await seedAuditReportData(page);

    await page.goto('/en/reports');

    await page.getByTestId('generate-report-button').click();
    await expect(page.getByTestId('report-summary')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-csv-button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const filePath = await download.path();
    expect(filePath).not.toBeNull();

    const fs = await import('fs');
    const stats = fs.statSync(filePath!);
    expect(stats.size).toBeGreaterThan(0);

    const content = fs.readFileSync(filePath!, 'utf-8');
    expect(content).toContain('Audit Report');
    expect(content).toContain('EVENTS DETAIL');
    expect(content).toContain('e2e-audit-prod');
  });

  test('generates an audit report and downloads a non-empty JSON artifact', async ({ page }) => {
    await seedAuditReportData(page);

    await page.goto('/en/reports');

    await page.getByTestId('generate-report-button').click();
    await expect(page.getByTestId('report-summary')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-json-button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/);

    const filePath = await download.path();
    expect(filePath).not.toBeNull();

    const fs = await import('fs');
    const stats = fs.statSync(filePath!);
    expect(stats.size).toBeGreaterThan(0);

    const content = fs.readFileSync(filePath!, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.summary.totalProducts).toBeGreaterThan(0);
    expect(parsed.summary.totalEvents).toBe(4);
    expect(parsed.summary.eventsByType).toMatchObject({
      HARVEST: 1,
      PROCESSING: 1,
      SHIPPING: 1,
      RETAIL: 1,
    });
  });

  test('renders observability page key metrics without runtime errors', async ({ page }) => {
    await seedWallet(page);

    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/en/observability');

    await expect(page.getByTestId('observability-page')).toBeVisible();
    await expect(page.getByText('API Observability')).toBeVisible();
    await expect(page.getByText('Endpoints tracked')).toBeVisible();
    await expect(page.getByText('Endpoint SLIs')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
