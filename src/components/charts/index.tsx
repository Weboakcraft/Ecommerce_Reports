import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cx, EmptyState, InfoTip } from '../ui';

/** Series colours are fixed per entity (never by rank). Validated with the dataviz palette checker. */
export const SERIES = {
  sales: 'var(--s-sales)',
  returns: 'var(--s-returns)',
  cancel: 'var(--s-cancel)',
  net: 'var(--s-net)',
};

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

type Datum = Record<string, string | number | null>;

const axisTick = { fill: 'var(--tick)', fontSize: 11 };

function TooltipBox({
  active, label, payload, series, format, labelFormat,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number }[];
  series: SeriesDef[];
  format: (n: number) => string;
  labelFormat?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p || p.value === undefined || p.value === null) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="num font-medium text-ink">{format(p.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** Time-based chart: lines for a trend, grouped bars for side-by-side comparison. One y-axis only. */
export function TrendChart({
  data, series, kind = 'line', format, axisFormat, labelFormat, tickFormat, height = 240,
}: {
  data: Datum[];
  series: SeriesDef[];
  kind?: 'line' | 'bar';
  format: (n: number) => string;
  axisFormat: (n: number) => string;
  labelFormat?: (l: string) => string;
  tickFormat?: (l: string) => string;
  height?: number;
}) {
  const common = {
    data,
    margin: { top: 8, right: 12, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis dataKey="key" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tickFormatter={tickFormat} minTickGap={28} interval="preserveStartEnd" />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={axisFormat} />
      <Tooltip
        cursor={kind === 'line' ? { stroke: 'var(--axis)' } : { fill: 'var(--grid)', opacity: 0.5 }}
        isAnimationActive={false}
        content={<TooltipBox series={series} format={format} labelFormat={labelFormat} />}
      />
    </>
  );
  return (
    <div>
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        {kind === 'line' ? (
          <LineChart {...common}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                dot={data.length <= 31 ? { r: 2, fill: s.color, strokeWidth: 0 } : false}
                activeDot={{ r: 4, stroke: 'rgb(var(--surface))', strokeWidth: 2 }} isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart {...common} barCategoryGap="28%" barGap={2}>
            {axes}
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars, one colour for the whole series, value written at the bar end. */
export function RankBars({
  data, color, format, name,
}: {
  data: { label: string; value: number; note?: string }[];
  color: string;
  format: (n: number) => string;
  name: string;
}) {
  const rows = data.map((d) => ({ ...d, key: d.label }));
  const longest = Math.min(22, rows.reduce((a, r) => Math.max(a, r.label.length), 6));
  const trunc = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 26 + 16)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} width={longest * 6.4 + 12} tickFormatter={trunc} interval={0} />
        <Tooltip
          cursor={{ fill: 'var(--grid)', opacity: 0.5 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { label: string; value: number; note?: string };
            return (
              <div className="rounded border border-line-strong bg-surface px-2.5 py-2 text-xs shadow-lg">
                <div className="mb-0.5 font-medium text-ink">{d.label}</div>
                <div className="flex items-center justify-between gap-4 text-ink-2">
                  {name} <span className="num font-medium text-ink">{format(d.value)}</span>
                </div>
                {d.note && <div className="mt-0.5 text-ink-3">{d.note}</div>}
              </div>
            );
          }}
        />
        <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" formatter={(v: number) => format(v)} style={{ fill: 'rgb(var(--ink-2))', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TableView {
  headers: string[];
  rows: (string | number)[][];
}

/** Chart frame with a chart/table switch, so every chart also has an accessible table view. */
export function ChartCard({
  title, info, subtitle, controls, children, table, empty, className,
}: {
  title: string;
  info?: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  table?: TableView;
  empty?: { title: string; body?: string } | null;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={cx('flex flex-col rounded-md border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {title}
            {info && <InfoTip text={info} />}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {controls}
          {table && !empty && (
            <button
              type="button"
              onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
              aria-label={view === 'chart' ? `Show ${title} as a table` : `Show ${title} as a chart`}
              title={view === 'chart' ? 'Show as table' : 'Show as chart'}
              className="rounded border border-line-strong p-1 text-ink-2 hover:bg-sunken"
            >
              {view === 'chart' ? <Table2 size={13} /> : <BarChart3 size={13} />}
            </button>
          )}
        </div>
      </header>
      <div className="flex-1 px-3.5 pb-3 pt-2">
        {empty ? (
          <EmptyState title={empty.title} body={empty.body} />
        ) : view === 'chart' || !table ? (
          children
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>{table.headers.map((h, i) => <th key={h} className={cx('th sticky top-0', i > 0 && 'text-right')}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className={cx('td', j > 0 && 'num text-right')}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
