/**
 * State-name normalization.
 *
 * Only harmless formatting differences are reconciled: surrounding/double
 * whitespace, letter case, "&" vs "and", and stray punctuation. A cleaned name
 * is matched EXACTLY against the canonical list or an explicit alias table.
 * There is no fuzzy matching: anything else is kept as cleaned text and listed
 * for review so two different states can never be merged by accident.
 */

export const CANONICAL_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli', 'Dadra and Nagar Haveli and Daman and Diu', 'Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
];

/** Explicit, unambiguous renames and official short forms. Keys are comparison keys. */
const BUILT_IN_ALIASES: Record<string, string> = {
  'ORISSA': 'Odisha',
  'PONDICHERRY': 'Puducherry',
  'UTTARANCHAL': 'Uttarakhand',
  'NEW DELHI': 'Delhi',
  'NCT OF DELHI': 'Delhi',
  'DELHI NCT': 'Delhi',
  'JAMMU AND KASHMIR UT': 'Jammu and Kashmir',
  'ANDAMAN AND NICOBAR': 'Andaman and Nicobar Islands',
  'CHATTISGARH': 'Chhattisgarh',
  'TAMILNADU': 'Tamil Nadu',
};

export const BLANK_STATE = '(blank state)';

/** Comparison key: upper-case, "&" -> AND, punctuation removed, whitespace collapsed. */
export function stateKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_BY_KEY: Record<string, string> = Object.fromEntries(
  CANONICAL_STATES.map((s) => [stateKey(s), s]),
);

export interface NormalizedState {
  state: string;
  /** False when the value was not recognised and needs review. */
  recognised: boolean;
}

export function normalizeState(raw: unknown, userAliases: Record<string, string> = {}): NormalizedState {
  const text = raw === null || raw === undefined ? '' : String(raw).replace(/\s+/g, ' ').trim();
  if (text === '') return { state: BLANK_STATE, recognised: false };
  const key = stateKey(text);
  // An empty key (a value made only of punctuation) must never match an alias.
  if (key && userAliases[key]) return { state: userAliases[key], recognised: true };
  if (CANONICAL_BY_KEY[key]) return { state: CANONICAL_BY_KEY[key], recognised: true };
  if (BUILT_IN_ALIASES[key]) return { state: BUILT_IN_ALIASES[key], recognised: true };
  // Unrecognised: keep the cleaned source text (Title Case for display), flag for review.
  const display = text
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return { state: display, recognised: false };
}
