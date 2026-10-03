import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { SkuRow } from '../analytics/sku-classification';
import { SKU_CLASS_LABEL, type SkuClass } from '../types';
import { fmtPct } from '../utils/format';
import { Badge, type Tone } from './ui';

const TONE: Record<SkuClass, Tone> = {
  TOP_REVENUE: 'accent', TOP_VOLUME: 'accent', HIGH_RETURN: 'warn', LOW_MOVEMENT: 'warn', NO_RECENT_SALES: 'neutral',
  LOSS_MAKING: 'bad', DECLINING: 'warn', INSUFFICIENT_DATA: 'neutral',
};

export function ClassBadges({ row }: { row: SkuRow }) {
  if (!row.classes.length) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex gap-1" title={row.classNotes.join('\n')}>
      {row.classes.map((c) => <Badge key={c} tone={TONE[c]}>{SKU_CLASS_LABEL[c]}</Badge>)}
    </span>
  );
}

export function Trend({ row }: { row: SkuRow }) {
  const m = row.movement;
  if (!m || !m.covered.trend) return <span className="text-ink-3" title="Imported data does not cover two full comparison windows">Not assessed</span>;
  if (m.trendPct === null) return <span className="text-ink-3" title="No sales in the previous window">No prior sales</span>;
  const up = m.trendPct > 0.05;
  const down = m.trendPct < -0.05;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? 'text-good' : down ? 'text-bad' : 'text-ink-2'}`}>
      <Icon size={13} aria-hidden />
      <span className="sr-only">{up ? 'Up' : down ? 'Down' : 'Flat'}</span>
      {fmtPct(Math.abs(m.trendPct))}
    </span>
  );
}

export const Unavailable = ({ reason }: { reason: string }) => (
  <span className="text-ink-3" title={reason}>Unavailable</span>
);
