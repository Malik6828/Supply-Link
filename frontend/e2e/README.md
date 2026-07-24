# Supply-Link E2E Testing Guide

This directory contains Playwright end-to-end tests for Supply-Link's critical user flows.

## Overview

### Test Structure

- **full-journey.spec.ts** - Main user flow: register → track → verify on public page
- **compliance-scorecard.spec.ts** - Compliance reporting and audit workflows
- **public-verification.spec.ts** - Public product verification page
- **wallet-requirement.spec.ts** - Wallet connection and state management
- **recall-broadcast.spec.ts** - Product recall and emergency alert flows
- **insurance-warranty.spec.ts** - Warranty and insurance coverage features
- **webhooks.spec.ts** - Webhook integration and delivery
- **api/** - API-only tests (no browser) for backend validation

### Test ID Conventions

Tests use `data-testid` attributes for reliable element targeting instead of brittle text/placeholder selectors:

```
[data-testid="landing-brand"]             - Brand name on landing page
[data-testid="wallet-connect-button"]     - Wallet connection button
[data-testid="wallet-status-connected"]   - Connected wallet status display
[data-testid="register-product-dialog"]   - Product registration dialog
[data-testid="register-product-submit"]   - Product registration submit button
[data-testid="add-event-form"]            - Tracking event form
[data-testid="add-event-submit"]          - Event submission button
[data-testid="verify-widget-submit-button"] - Product verification button
```

See component test IDs in source files for complete list.

## Running Tests

### Run All Tests

```bash
npm run test:e2e
```

### Run Specific Test File

```bash
npm run test:e2e -- full-journey.spec.ts
```

### Run in UI Mode (for debugging)

```bash
npm run test:e2e:ui
```

### Run in Debug Mode

```bash
npm run test:e2e:debug
```

### Run with Specific Browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Run API Tests Only

```bash
npm run test:e2e:api
```

## Wallet Mocking Strategy

### How Mock Wallet Works

The test suite uses a mock Freighter wallet implementation (`e2e/support/wallet-mock.ts`) that:

1. Injects a fake `window.freighterApi` object before page navigation
2. Simulates wallet connection, transaction signing, and network checks
3. Eliminates dependency on real Freighter extension or wallet
4. Provides deterministic test behavior in CI environments

### Using Mock Wallet in Tests

```typescript
import { injectFreighterMock, waitForWalletConnection, MOCK_WALLET_ADDRESS } from './support/wallet-mock';

test('my test', async ({ page }) => {
  // Inject mock before navigation
  await injectFreighterMock(page);
  
  // Navigate and use normally
  await page.goto('/en');
  
  // Connect wallet
  const connectButton = page.locator('[data-testid="wallet-connect-button"]');
  await connectButton.click();
  
  // Wait for connection
  await waitForWalletConnection(page, 5000);
  
  // Verify wallet state
  const walletStatus = page.locator('[data-testid="wallet-status-connected"]');
  await expect(walletStatus).toBeVisible();
});
```

### Mock Wallet Details

- **Address**: `GAJM7UNEQZWGPQJ4IGVBV6WLBR2IXPVLWVHFMYUVVGQPZQIHQVYGLVL`
- **Network**: Stellar Testnet (`Test SDF Network ; September 2015`)
- **XLM Balance**: 1000 (mock)

### Limitations

- Mock wallet does not perform real cryptographic operations
- Transaction signing is simulated with mock signatures
- On-chain contract interactions are not validated in E2E tests
- For API-level validation, see `e2e/api/` tests

## CI/CD Integration

### Environment Variables

Tests use these environment variables in CI:

```bash
PARTNER_API_KEY=test-partner-key-e2e
INTERNAL_API_KEY=test-internal-key-e2e
TRUSTED_PROXY=true
NEXT_PUBLIC_MOCK_WALLET=true  # Enables mock wallet mode
```

### CI Configuration

In CI, Playwright:

1. Uses a single worker (serial execution) to avoid resource contention
2. Retries failed tests 2 times
3. Records traces on first retry for debugging
4. Generates HTML reports in `playwright-report/`

## Test Data

### Mock Products

Mock product data is seeded from `lib/mock/products.ts`:

- `prod-001` - Organic Coffee Beans (Ethiopia)
- `prod-002` - Cocoa Beans (Ghana)
- `prod-003` - Chocolate Bar (Europe)
- `prod-e2e-*` - E2E-specific test products

### Creating Test Products

Tests can create products dynamically:

```typescript
await page.fill('[data-testid="register-product-name-input"]', 'Test Product ' + Date.now());
await page.fill('[data-testid="register-product-origin-input"]', 'Test Origin');
await page.click('[data-testid="register-product-submit"]');
```

## Debugging Tips

### View Test Trace

After a test failure in CI, traces are saved and can be viewed:

```bash
npx playwright show-trace playwright-report/trace.zip
```

### Run Single Test in Headed Mode

```bash
npx playwright test full-journey.spec.ts --project=chromium --headed
```

### Enable Verbose Logging

```bash
PWDEBUG=1 npm run test:e2e -- full-journey.spec.ts
```

### Check Viewport Size

Tests use `Desktop Chrome` (1280x720) by default. Adjust in `playwright.config.ts` if needed.

## Common Issues

### Test Timeout

- Increase timeout in test or playwright.config.ts
- Check if mock server is running: `npm run dev`
- Verify network connectivity

### Element Not Found

- Use `[data-testid="..."]` selectors instead of text/class selectors
- Add `{ timeout: 10000 }` to wait operations
- Check browser console for JS errors in `page.goto()` response

### Wallet Not Connected

- Verify mock is injected before page navigation
- Check that `[data-testid="wallet-connect-button"]` exists
- Ensure `NEXT_PUBLIC_MOCK_WALLET=true` is set

### Flaky Tests

- Use explicit waits: `waitForLoadState('networkidle')`, not `page.waitForTimeout()`
- Increase timeout for cold Turbopack builds (set to 45s+)
- Avoid assertions on timing; wait for element visibility instead

## Adding New Tests

1. Create a new `.spec.ts` file in `e2e/` directory
2. Follow the pattern in existing tests
3. Use `data-testid` attributes for element targeting
4. Inject mock wallet if testing wallet flows
5. Use meaningful test names describing the user journey

Example:

```typescript
import { test, expect } from '@playwright/test';
import { injectFreighterMock, waitForWalletConnection } from './support/wallet-mock';

test.describe('E2E: My Feature', () => {
  test('user can do X', async ({ page }) => {
    await injectFreighterMock(page);
    
    await page.goto('/en');
    // ... test steps
  });
});
```

## Performance

- Full test suite: ~5-10 minutes (serial on 1 worker)
- Individual test: ~30-90 seconds
- CI should complete within 30 minutes total (including retries)

## Documentation

- Playwright Docs: https://playwright.dev/
- Testing Best Practices: https://playwright.dev/docs/best-practices
- Locator Documentation: https://playwright.dev/docs/locators
