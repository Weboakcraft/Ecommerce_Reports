import type { Platform } from '../types';
import { amazonAdapter } from './amazon';
import { flipkartAdapter } from './flipkart';
import { myntraAdapter } from './myntra';
import { shopifyAdapter } from './shopify';
import type { PlatformAdapter } from './types';

/** Registry: one adapter per marketplace, all emitting the same canonical Transaction. */
export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  flipkart: flipkartAdapter,
  amazon: amazonAdapter,
  myntra: myntraAdapter,
  shopify: shopifyAdapter,
};

export * from './types';
export { openSource, detectFileKind, FileValidationError } from './source';
