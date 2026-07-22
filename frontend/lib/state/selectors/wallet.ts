import type { SupplyLinkStore } from '../types';
import { useStore } from '../store';

export function selectWalletAddress(state: SupplyLinkStore): string | null {
  return state.walletAddress;
}

export function selectXlmBalance(state: SupplyLinkStore): string | null {
  return state.xlmBalance;
}

export function selectNetworkMismatch(state: SupplyLinkStore): boolean {
  return state.networkMismatch;
}

export function selectIsWalletConnected(state: SupplyLinkStore): boolean {
  return state.walletAddress !== null;
}

export function useWalletAddress(): string | null {
  return useStore(selectWalletAddress);
}

export function useXlmBalance(): string | null {
  return useStore(selectXlmBalance);
}

export function useNetworkMismatch(): boolean {
  return useStore(selectNetworkMismatch);
}
