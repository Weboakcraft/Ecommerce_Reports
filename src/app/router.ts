import { useEffect, useState } from 'react';

export type PageId =
  | 'overview' | 'sku' | 'pnl' | 'returns' | 'movement' | 'states' | 'marketplaces' | 'costs' | 'import'
  | 'reports' | 'settings';

export const PAGE_IDS: PageId[] = [
  'overview', 'sku', 'pnl', 'returns', 'movement', 'states', 'marketplaces', 'costs', 'import', 'reports', 'settings',
];

const parse = (): PageId => {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0] as PageId;
  return PAGE_IDS.includes(id) ? id : 'overview';
};

/** Hash-based navigation: works on GitHub Pages with no server rewrites. */
export function usePage(): [PageId, (p: PageId) => void] {
  const [page, setPage] = useState<PageId>(parse);
  useEffect(() => {
    const onHash = () => setPage(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [page, (p) => { window.location.hash = `/${p}`; }];
}

export const go = (p: PageId) => { window.location.hash = `/${p}`; };
