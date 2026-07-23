/**
 * Wallet Mock Strategy for Playwright E2E Tests
 * 
 * Injects a fake window.freighterApi object into the browser context
 * to simulate Freighter wallet behavior without requiring a real wallet extension.
 */

import type { Page } from '@playwright/test';

export const MOCK_WALLET_ADDRESS = 'GAJM7UNEQZWGPQJ4IGVBV6WLBR2IXPVLWVHFMYUVVGQPZQIHQVYGLVL';
export const MOCK_XLM_BALANCE = 1000;
export const MOCK_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * Injects a mock Freighter API into the page
 * This allows E2E tests to run without requiring Freighter extension
 */
export async function injectFreighterMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Mock window.freighterApi
    const mockFreighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => MOCK_WALLET_ADDRESS,
      signTransaction: async (xdr: string) => {
        // Return a dummy signed transaction
        return {
          envelope_xdr: xdr,
          hash: 'mock_hash_' + Math.random().toString(36).slice(2, 9),
        };
      },
      signAuthEntry: async (entry: string) => {
        return {
          result: entry,
        };
      },
      getNetwork: async () => ({
        network: 'TESTNET',
        networkPassphrase: MOCK_NETWORK_PASSPHRASE,
      }),
      requestAccess: async () => ({
        address: MOCK_WALLET_ADDRESS,
      }),
    };

    // Inject into window
    Object.defineProperty(window, 'freighterApi', {
      value: mockFreighterApi,
      writable: false,
      configurable: false,
    });
  });

  // Also inject our constants as globals for test assertions
  await page.addInitScript(
    ({ address, balance, passphrase }) => {
      Object.defineProperty(window, '__mockWalletAddress', {
        value: address,
        configurable: false,
      });
      Object.defineProperty(window, '__mockXlmBalance', {
        value: balance,
        configurable: false,
      });
      Object.defineProperty(window, '__mockNetworkPassphrase', {
        value: passphrase,
        configurable: false,
      });
    },
    {
      address: MOCK_WALLET_ADDRESS,
      balance: MOCK_XLM_BALANCE,
      passphrase: MOCK_NETWORK_PASSPHRASE,
    }
  );
}

/**
 * Waits for wallet to be connected in the UI
 */
export async function waitForWalletConnection(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="wallet-status-connected"]', { timeout });
}

/**
 * Retrieves the connected wallet address from the page
 */
export async function getConnectedWalletAddress(page: Page): Promise<string> {
  const element = await page.locator('[data-testid="wallet-address-display"]').first();
  return element.textContent({ timeout: 5000 }) as Promise<string>;
}
