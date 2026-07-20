/**
 * Contract client type definitions.
 * This module provides the SupplyLinkContractClient interface used by
 * provenance scoring and identifier canonicalization utilities.
 *
 * In production, replace with the generated Soroban contract bindings.
 */

/**
 * Generic contract client interface for Supply-Link smart contract interactions.
 * Methods correspond to the on-chain contract functions.
 */
export interface SupplyLinkContractClient {
  // Provenance score management
  set_provenance_score(args: {
    product_id: string;
    score: number;
    schema_version: number;
    verified_event_count: number;
  }): Promise<unknown>;

  get_provenance_score(args: { product_id: string }): Promise<{
    score: number;
    last_calculated_at: number;
    verified_event_count: number;
    schema_version: number;
  } | null>;

  get_provenance_score_history(args: { product_id: string; limit?: number }): Promise<
    Array<{
      score: number;
      calculated_at: number;
      schema_version: number;
    }>
  >;

  // Product identifier canonicalization
  resolve_product_id(args: { id: string }): Promise<{ canonical_id: string } | null>;

  register_product_alias(args: { canonical_id: string; alias: string }): Promise<boolean>;

  get_product_aliases(args: { canonical_id: string }): Promise<string[]>;

  // Generic fallback for unknown methods
  [key: string]: (...args: unknown[]) => Promise<unknown>;
}
