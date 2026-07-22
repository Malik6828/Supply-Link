import { z } from 'zod';

export {
  eventMetadataSchemas,
  validateEventMetadata,
  harvestMetadataSchema,
  processingMetadataSchema,
  shippingMetadataSchema,
  retailMetadataSchema,
} from '@/lib/api/eventMetadataSchemas';

export type {
  EventMetadata,
  HarvestMetadata,
  ProcessingMetadata,
  ShippingMetadata,
  RetailMetadata,
} from '@/lib/api/eventMetadataSchemas';

export const metadataSchema = z.record(z.string(), z.unknown());

export function validateMetadata(raw: string): {
  valid: boolean;
  data?: Record<string, unknown>;
  error?: string;
} {
  try {
    const parsed = JSON.parse(raw);
    const result = metadataSchema.safeParse(parsed);
    if (result.success) return { valid: true, data: result.data };
    return { valid: false, error: result.error.message };
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }
}

/**
 * Compute a SHA-256 hex digest of arbitrary bytes using the Web Crypto API.
 * Works in browsers and Node ≥18.
 */
export async function computeContentHash(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer: ArrayBuffer = data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data;
  const digest = new Uint8Array(
    (await globalThis.crypto.subtle.digest('SHA-256', buffer)) as ArrayBuffer,
  );
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute a SHA-256 hex digest of a File object.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return computeContentHash(buffer);
}

/**
 * Verify that a downloaded asset (ArrayBuffer) matches a stored hex hash.
 * Returns true only when the hashes match exactly.
 */
export async function verifyContentHash(
  data: ArrayBuffer | Uint8Array,
  expectedHex: string,
): Promise<boolean> {
  const actual = await computeContentHash(data);
  if (actual.length !== expectedHex.length) return false;
  // Constant-time comparison to avoid timing leaks.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}
