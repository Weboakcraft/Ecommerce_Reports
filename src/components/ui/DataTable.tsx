import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cx, EmptyState, InfoTip } from './index';

export interface Column<T> {
  key: string;
  header: string;
  /** Sort / search value. */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  info?: string;
  sortable?: boolean;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Text searched by the search box. Omit to hide the box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
  onRowClick?: (row: T) => void;
  dense?: boolean;
}

/** Sortable, searchable, paginated table. Only one page of rows is ever in the DOM. */
export function DataTable<T>({
  rows, columns, rowKey, searchText, searchPlaceholder = 'Search', initialSort, pageSize = 25, toolbar,
  emptyTitle = 'Nothing to show', emptyBody, onRowClick,
}: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(needle));
  }, [rows, q, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      // Missing values always sort last, whichever direction is chosen.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'en', { numeric: true }) * dir;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  useEffect(() => {
    if (page > pages - 1) setPage(0);
  }, [page, pages]);
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * size, current * size + size);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  return (
    <div>
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          {searchText ? (
            <div className="flex h-8 w-60 max-w-full items-center gap-1.5 rounded border border-line-strong bg-surface px-2">
              <Search size={14} className="text-ink-3" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent text-sm outline-none placeholder:text-ink-3"
              />
            </div>
          ) : <span />}
          {toolbar && <div className="flex items-center gap-1.5">{toolbar}</div>}
        </div>
      )}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c, ci) => {
                const active = sort?.key === c.key;
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('th', c.align === 'right' && 'text-right', ci === 0 && 'sticky left-0 z-[1]')}
                  >
                    <span className={cx('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse')}>
                      {sortable ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-0.5 hover:text-ink">
                          {c.header}
                          {active && (sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      ) : c.header}
                      {c.info && <InfoTip text={c.info} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx('hover:bg-sunken/60', onRowClick && 'cursor-pointer')}
              >
                {columns.map((c, ci) => (
                  <td key={c.key} className={cx('td', c.align === 'right' && 'num text-right', ci === 0 && 'sticky left-0 z-[1] bg-surface', c.className)}>
                    {c.render ? c.render(r) : (c.value(r) ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <EmptyState title={q ? 'No rows match your search' : emptyTitle} body={q ? undefined : emptyBody} />}
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-ink-2">
          <span className="num">
            {(current * size + 1).toLocaleString('en-IN')}–{Math.min(sorted.length, (current + 1) * size).toLocaleString('en-IN')} of{' '}
            {sorted.length.toLocaleString('en-IN')}
            {sorted.length !== rows.length && ` (filtered from ${rows.length.toLocaleString('en-IN')})`}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              Rows
              <select
                value={size}
                onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}
                className="h-7 rounded border border-line-strong bg-surface px-1 text-xs"
              >
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-line-strong p-1 disabled:opacity-40">
              <ChevronLeft size={14} />
            </button>
            <span className="num">Page {current + 1} of {pages}</span>
            <button type="button" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-line-strong p-1 disabled:opacity-40">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
