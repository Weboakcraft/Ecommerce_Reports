import type { PlatformAdapter } from '../types';
import { AdapterNotImplementedError } from '../types';

/**
 * Amazon adapter — architecture prepared, NOT implemented.
 *
 * It will be written once a real Amazon report is supplied. Nothing about Amazon's
 * columns, event values, date semantics, tax treatment, order identifiers or
 * return structure is assumed from the Flipkart format. To implement:
 *   1. add src/schemas/amazon.ts describing the report layout and validation rules;
 *   2. implement checkStructure() and parse() to emit canonical Transaction records;
 *   3. add default event mappings for platform 'amazon' in src/schemas/defaults.ts;
 *   4. add adapter tests, then set `implemented: true`.
 */
export const amazonAdapter: PlatformAdapter = {
  platform: 'amazon',
  implemented: false,
  formatDescription: 'Not available yet. This adapter will be built from an actual Amazon report file.',
  checkStructure() {
    return {
      ok: false,
      errors: ['Amazon import is not available yet. Supply a sample Amazon report so its adapter can be built and validated.'],
      notices: [],
      sheetName: null,
    };
  },
  parse() {
    throw new AdapterNotImplementedError('Amazon adapter is not implemented.');
  },
};
