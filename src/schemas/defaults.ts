import type { EventMapping, Filters, Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  reportingTimezone: 'Asia/Kolkata',
  dayMonthOrder: 'DMY',
  flipkartHeaderRows: 1,
  cancellationPolicy: 'separate',
  returnCostPolicy: 'resalable_full',
  topN: 10,
  highReturnRatePct: 20,
  highReturnMinUnits: 10,
  lowMovementDays: 30,
  lowMovementMaxUnits: 5,
  noRecentSalesDays: 30,
  decliningPct: 30,
  decliningWindowDays: 30,
  minTxnForClassification: 5,
  velocityWindowDays: 30,
  cohortMinLinkagePct: 90,
  coverageGapDays: 7,
  unusualReturnRatePct: 40,
  maxFileSizeMb: 50,
  stateAliases: {},
  userName: '',
};

/**
 * Default Flipkart Event Sub Type mapping.
 *
 * IMPORTANT: these defaults were written WITHOUT access to a real Flipkart
 * workbook. They are exact, case-insensitive matches on three plainly named
 * values and nothing else. Every distinct event value found in an upload is
 * shown in the Import Center with its row count, quantity and amount so the
 * mapping can be confirmed or corrected before import. Any other value
 * (for example "Return Cancellation") stays UNMAPPED until an administrator
 * maps it; nothing is inferred from substrings.
 */
export const DEFAULT_EVENT_MAPPINGS: EventMapping[] = [
  { platform: 'flipkart', eventValue: 'Sale', txnType: 'SALE', source: 'default', updatedAt: '' },
  { platform: 'flipkart', eventValue: 'Return', txnType: 'RETURN', source: 'default', updatedAt: '' },
  { platform: 'flipkart', eventValue: 'Cancellation', txnType: 'CANCELLATION', source: 'default', updatedAt: '' },
];

export const EMPTY_FILTERS: Filters = {
  dateFrom: '',
  dateTo: '',
  datePreset: 'all',
  platforms: [],
  skus: [],
  txnTypes: [],
  states: [],
  minSalesUnits: null,
  returnRateThresholdPct: null,
  profitStatus: 'all',
  classifications: [],
};
