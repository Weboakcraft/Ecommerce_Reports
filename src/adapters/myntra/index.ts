import type { PlatformAdapter } from '../types';
import { AdapterNotImplementedError } from '../types';

/**
 * Myntra adapter — architecture prepared, NOT implemented.
 *
 * It will be written once a real Myntra report is supplied. Nothing about Myntra's
 * columns, event values, date semantics, tax treatment, order identifiers or
 * return structure is assumed from the Flipkart format. To implement:
 *   1. add src/schemas/myntra.ts describing the report layout and validation rules;
 *   2. implement checkStructure() and parse() to emit canonical Transaction records;
 *   3. add default event mappings for platform 'myntra' in src/schemas/defaults.ts;
 *   4. add adapter tests, then set `implemented: true`.
 */
export const myntraAdapter: PlatformAdapter = {
  platform: 'myntra',
  implemented: false,
  formatDescription: 'Not available yet. This adapter will be built from an actual Myntra report file.',
  checkStructure() {
    return {
      ok: false,
      errors: ['Myntra import is not available yet. Supply a sample Myntra report so its adapter can be built and validated.'],
      notices: [],
      sheetName: null,
    };
  },
  parse() {
    throw new AdapterNotImplementedError('Myntra adapter is not implemented.');
  },
};
