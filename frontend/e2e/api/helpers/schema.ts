/**
 * OpenAPI schema validator (Ajv-based).
 *
 * Fetches the spec once from /api/openapi (served by the dev server), compiles
 * the named component schemas, and exposes a `validate(schemaName, data)`
 * helper used by the spec files to assert response bodies match the contract.
 *
 * The spec is fetched lazily on the first call to `getValidator()` and cached
 * for the lifetime of the test process.
 *
 * Usage:
 *   import { getValidator } from '../helpers/schema';
 *   const v = await getValidator(request);
 *   v.assertValid('Product', body);          // throws if invalid
 *   v.assertValid('PaginatedProducts', body);
 */

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { APIRequestContext } from '@playwright/test';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchemaValidator {
  /** Throw an error with details if `data` does not conform to `schemaName`. */
  assertValid(schemaName: string, data: unknown): void;
  /** Return true if `data` conforms to `schemaName` (non-throwing variant). */
  isValid(schemaName: string, data: unknown): boolean;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let cachedValidator: SchemaValidator | null = null;

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Fetch the OpenAPI spec from the running server and compile all component
 * schemas into Ajv validators.  The result is cached across calls.
 */
export async function getValidator(request: APIRequestContext): Promise<SchemaValidator> {
  if (cachedValidator) return cachedValidator;

  const res = await request.get('/api/openapi');
  if (!res.ok()) {
    throw new Error(`getValidator: Failed to fetch OpenAPI spec. Status=${res.status()}`);
  }

  // The route serves JSON (parsed YAML)
  const spec = (await res.json()) as {
    components?: {
      schemas?: Record<string, unknown>;
    };
  };

  const schemas = spec.components?.schemas ?? {};

  const ajv = new Ajv({
    allErrors: true,
    strict: false, // allow extra keywords present in OpenAPI 3.x (e.g. nullable)
    coerceTypes: false,
  });
  addFormats(ajv);

  // Add all component schemas under their name so $ref resolution works.
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema as Record<string, unknown>, `#/components/schemas/${name}`);
  }

  // Compile a named validator map
  const validators = new Map<string, ValidateFunction>();
  for (const [name, schema] of Object.entries(schemas)) {
    try {
      validators.set(name, ajv.compile(schema as Record<string, unknown>));
    } catch {
      // Skip schemas that fail to compile (e.g. forward $refs not yet resolved)
    }
  }

  cachedValidator = {
    assertValid(schemaName: string, data: unknown): void {
      const validate = validators.get(schemaName);
      if (!validate) {
        throw new Error(
          `assertValid: No compiled schema found for "${schemaName}". ` +
            `Available: ${[...validators.keys()].join(', ')}`,
        );
      }
      const valid = validate(data);
      if (!valid) {
        const errors = ajv.errorsText(validate.errors, { separator: '\n  ' });
        throw new Error(
          `Schema validation failed for "${schemaName}":\n  ${errors}\n` +
            `Data: ${JSON.stringify(data, null, 2)}`,
        );
      }
    },

    isValid(schemaName: string, data: unknown): boolean {
      const validate = validators.get(schemaName);
      if (!validate) return false;
      return validate(data) as boolean;
    },
  };

  return cachedValidator;
}
