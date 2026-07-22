/**
 * frontend/lib/stellar/contract.ts
 *
 * Unified Soroban contract invocation layer (#582).
 * Exposes a strongly-typed ContractClient interface backed by LiveContractClient
 * or MockContractClient based on NEXT_PUBLIC_USE_MOCK_CONTRACT.
 */

import type { TrackingEvent, EventType, EventFilter, EventPage, AuthPolicy } from '@/lib/types';
import type { ContractClient, ContractClientConfig } from './contract-client.interface';
import { LiveContractClient } from './live-contract-client';
import { MockContractClient, applyFilter } from './mock-contract-client';

export type { ContractClient, ContractClientConfig };
export { LiveContractClient, MockContractClient };

/**
 * Factory to create a ContractClient instance.
 * Automatically checks NEXT_PUBLIC_USE_MOCK_CONTRACT if useMock is not explicitly set.
 */
export function createContractClient(config?: ContractClientConfig): ContractClient {
  const useMock = config?.useMock ?? process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT === 'true';
  return useMock ? new MockContractClient() : new LiveContractClient(config);
}

/**
 * Default singleton ContractClient instance.
 * Uses a Proxy to evaluate the client dynamically at call time based on configuration.
 */
export const contractClient: ContractClient = new Proxy({} as ContractClient, {
  get(_target, prop: keyof ContractClient) {
    const client = createContractClient();
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

// ── Re-exported Paginated Event Helpers ─────────────────────────────────────

export async function fetchEventPage(
  productId: string,
  offset: number,
  limit: number = 20,
  filter?: EventFilter,
): Promise<EventPage> {
  return contractClient.fetchEventPage(productId, offset, limit, filter);
}

export async function fetchAllEvents(
  productId: string,
  filter?: EventFilter,
  pageSize: number = 20,
): Promise<TrackingEvent[]> {
  return contractClient.fetchAllEvents(productId, filter, pageSize);
}

export async function fetchProvenancePath(productId: string): Promise<TrackingEvent[]> {
  return contractClient.fetchProvenancePath(productId);
}

export async function fetchAuthPolicy(productId: string): Promise<AuthPolicy> {
  return contractClient.fetchAuthPolicy(productId);
}

// ── Pure Filtering Helpers ──────────────────────────────────────────────────

export { applyFilter };

export function extractActors(events: TrackingEvent[]): string[] {
  return [...new Set(events.map((e) => e.actor))];
}

export function extractEventTypes(events: TrackingEvent[]): EventType[] {
  return [...new Set(events.map((e) => e.eventType))] as EventType[];
}
