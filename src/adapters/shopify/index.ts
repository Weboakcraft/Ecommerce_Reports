import type { PlatformAdapter } from '../types';
import { AdapterNotImplementedError } from '../types';

/**
 * Shopify adapter — architecture prepared, NOT implemented.
 *
 * It will be written once a real Shopify report is supplied. Nothing about Shopify's
 * columns, event values, date semantics, tax treatment, order identifiers or
 * return structure is assumed from the Flipkart format. To implement:
 *   1. add src/schemas/shopify.ts describing the report layout and validation rules;
 *   2. implement checkStructure() and parse() to emit canonical Transaction records;
 *   3. add default event mappings for platform 'shopify' in src/schemas/defaults.ts;
 *   4. add adapter tests, then set `implemented: true`.
 */
export const shopifyAdapter: PlatformAdapter = {
  platform: 'shopify',
  implemented: false,
  formatDescription: 'Not available yet. This adapter will be built from an actual Shopify report file.',
  checkStructure() {
    return {
      ok: false,
      errors: ['Shopify import is not available yet. Supply a sample Shopify report so its adapter can be built and validated.'],
      notices: [],
      sheetName: null,
    };
  },
  parse() {
    throw new AdapterNotImplementedError('Shopify adapter is not implemented.');
  },
};
