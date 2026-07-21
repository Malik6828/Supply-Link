import { isConnected, signTransaction, getAddress } from '@stellar/freighter-api';
import { contractClient } from './contract';
import type {
  Product,
  Delegation,
  ProductAssembly,
  WarrantyInfo,
  WarrantyClaim,
  ClaimStatus,
} from '../types';

export type StellarNetwork = 'testnet' | 'mainnet';

interface NetworkConfig {
  passphrase: string;
  rpcUrl: string;
  name: string;
}

const NETWORKS: Record<StellarNetwork, NetworkConfig> = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    name: 'Testnet',
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban-mainnet.stellar.org',
    name: 'Mainnet',
  },
};

const CURRENT_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as StellarNetwork) || 'testnet';

const NETWORK_CONFIG = NETWORKS[CURRENT_NETWORK];

export function getNetwork(): StellarNetwork {
  return CURRENT_NETWORK;
}

export function getNetworkName(): string {
  return NETWORK_CONFIG.name;
}

export class FreighterNotInstalledError extends Error {
  constructor() {
    super('Freighter wallet extension is not installed');
    this.name = 'FreighterNotInstalledError';
  }
}

export async function getWalletAddress(): Promise<string | null> {
  try {
    const result = await isConnected();
    if (!result.isConnected) return null;
    const addressResult = await getAddress();
    return addressResult.address;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Freighter') ||
        error.message.includes('not installed') ||
        error.message.includes('extension'))
    ) {
      throw new FreighterNotInstalledError();
    }
    throw error;
  }
}

export async function safeSignTransaction(transaction: string): Promise<string> {
  try {
    const result = await signTransaction(transaction);
    return result.signedTxXdr;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Freighter') || error.message.includes('not installed'))
    ) {
      throw new FreighterNotInstalledError();
    }
    throw error;
  }
}

export { signTransaction };

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? 'CBUWSKT2UGOAXK4ZREVDJV5XHSYB42PZ3CERU2ZFUTUMAZLJEHNZIECA';

export const NETWORK_PASSPHRASE = NETWORK_CONFIG.passphrase;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? NETWORK_CONFIG.rpcUrl;

// ── Contract Operation Delegates ───────────────────────────────────────────
// These functions delegate directly to the unified contractClient, ensuring
// backwards compatibility for components while removing code duplication.

export async function registerProduct(
  productId: string,
  name: string,
  origin: string,
  description: string,
  callerAddress: string,
): Promise<string> {
  return contractClient.registerProduct(
    productId,
    name,
    origin,
    callerAddress,
    callerAddress,
    description,
  );
}

export async function listProducts(
  page = 0,
  pageSize = 20,
): Promise<{ products: Product[]; total: number }> {
  return contractClient.listProducts(page, pageSize);
}

export async function transferOwnership(
  productId: string,
  newOwner: string,
  callerAddress: string,
): Promise<void> {
  await contractClient.transferOwnership(productId, newOwner, callerAddress);
}

export async function addAuthorizedActor(
  productId: string,
  actor: string,
  callerAddress: string,
): Promise<void> {
  await contractClient.addAuthorizedActor(productId, actor, callerAddress);
}

export async function removeAuthorizedActor(
  productId: string,
  actor: string,
  callerAddress: string,
): Promise<void> {
  await contractClient.removeAuthorizedActor(productId, actor, callerAddress);
}

export async function delegateActorAuthority(
  productId: string,
  delegatee: string,
  expiresAt: number,
  callerAddress: string,
): Promise<void> {
  await contractClient.delegateActorAuthority(productId, delegatee, expiresAt, callerAddress);
}

export async function revokeDelegate(
  productId: string,
  delegationId: number,
  callerAddress: string,
): Promise<void> {
  await contractClient.revokeDelegate(productId, delegationId, callerAddress);
}

export async function getActiveDelegations(productId: string): Promise<Delegation[]> {
  return contractClient.getActiveDelegations(productId);
}

export async function registerAssembly(
  parentId: string,
  componentIds: string[],
  description: string,
  callerAddress: string,
): Promise<string> {
  return contractClient.registerAssembly(parentId, componentIds, description, callerAddress);
}

export async function getAssembly(parentId: string): Promise<ProductAssembly | null> {
  return contractClient.getAssembly(parentId);
}

export async function getParentsOfComponent(
  componentId: string,
  candidateParentIds: string[],
): Promise<string[]> {
  return contractClient.getParentsOfComponent(componentId, candidateParentIds);
}

export async function registerWarranty(
  productId: string,
  durationSeconds: number,
  terms: string,
  termsRef: string,
  callerAddress: string,
): Promise<string> {
  return contractClient.registerWarranty(
    productId,
    durationSeconds,
    terms,
    termsRef,
    callerAddress,
  );
}

export async function getWarranty(productId: string): Promise<WarrantyInfo | null> {
  return contractClient.getWarranty(productId);
}

export async function voidWarranty(productId: string, callerAddress: string): Promise<string> {
  return contractClient.voidWarranty(productId, callerAddress);
}

export async function isWarrantyActive(productId: string): Promise<boolean> {
  return contractClient.isWarrantyActive(productId);
}

export async function fileWarrantyClaim(
  productId: string,
  claimId: string,
  description: string,
  proofRef: string,
  callerAddress: string,
): Promise<string> {
  return contractClient.fileWarrantyClaim(productId, claimId, description, proofRef, callerAddress);
}

export async function listWarrantyClaims(productId: string): Promise<WarrantyClaim[]> {
  return contractClient.listWarrantyClaims(productId);
}

export async function updateClaimStatus(
  productId: string,
  claimId: string,
  newStatus: ClaimStatus,
  callerAddress: string,
): Promise<string> {
  return contractClient.updateClaimStatus(productId, claimId, newStatus, callerAddress);
}
