import { useEffect } from 'react';
import { ProgressBar } from '../components/ui';
import CostsPage from '../modules/product-costs/Page';
import GeographyPage from '../modules/geography/Page';
import ImportPage from '../modules/imports/Page';
import MarketplacePage from '../modules/marketplace-comparison/Page';
import MovementPage from '../modules/product-movement/Page';
import OverviewPage from '../modules/overview/Page';
import ProfitabilityPage from '../modules/profitability/Page';
import ReportsPage from '../modules/reports/Page';
import ReturnsPage from '../modules/returns/Page';
import SettingsPage from '../modules/settings/Page';
import SkuAnalyticsPage from '../modules/sku-analytics/Page';
import { useStore } from '../storage/store';
import { useAnalytics } from './analytics';
import { FilterBar } from './FilterBar';
import { usePage, type PageId } from './router';
import { Shell } from './Shell';

/** Pages on which the global filters apply and the filter bar is shown. */
const FILTERED: PageId[] = ['overview', 'sku', 'pnl', 'returns', 'movement', 'states', 'marketplaces', 'reports'];

let started = false;

export default function App() {
  const status = useStore((s) => s.status);
  const busy = useStore((s) => s.busy);
  const init = useStore((s) => s.init);
  const [page, navigate] = usePage();
  const a = useAnalytics();

  useEffect(() => {
    if (started) return; // StrictMode mounts twice in development; load once
    started = true;
    void init();
  }, [init]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <p className="mb-2 text-sm font-medium">{busy?.label ?? 'Loading your data'}…</p>
          <ProgressBar value={busy?.progress ?? null} />
        </div>
      </div>
    );
  }

  return (
    <Shell page={page} onNavigate={navigate} filterBar={FILTERED.includes(page) && a.hasData ? <FilterBar a={a} /> : null}>
      {page === 'overview' && <OverviewPage a={a} />}
      {page === 'sku' && <SkuAnalyticsPage a={a} />}
      {page === 'pnl' && <ProfitabilityPage a={a} />}
      {page === 'returns' && <ReturnsPage a={a} />}
      {page === 'movement' && <MovementPage a={a} />}
      {page === 'states' && <GeographyPage a={a} />}
      {page === 'marketplaces' && <MarketplacePage a={a} />}
      {page === 'costs' && <CostsPage a={a} />}
      {page === 'import' && <ImportPage a={a} />}
      {page === 'reports' && <ReportsPage a={a} />}
      {page === 'settings' && <SettingsPage />}
    </Shell>
  );
}
