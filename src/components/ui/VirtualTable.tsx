import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';
import { cx } from './index';

export interface VColumn<T> {
  key: string;
  header: string;
  width: number;
  align?: 'right';
  render: (row: T) => ReactNode;
}

/** Windowed table: renders only the rows in view, so 100k+ transactions scroll smoothly. */
export function VirtualTable<T>({ rows, columns, height = 420 }: { rows: T[]; columns: VColumn<T>[]; height?: number }) {
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 30, overscan: 12 });
  const total = columns.reduce((a, c) => a + c.width, 0);
  return (
    <div ref={parent} className="overflow-auto" style={{ height }} tabIndex={0} aria-label="Transactions">
      <div style={{ width: total, minWidth: '100%' }}>
        <div className="sticky top-0 z-10 flex border-b border-line-strong bg-sunken">
          {columns.map((c) => (
            <div key={c.key} style={{ width: c.width }} className={cx('shrink-0 px-2.5 py-1.5 text-xs font-medium text-ink-2', c.align === 'right' && 'text-right')}>
              {c.header}
            </div>
          ))}
        </div>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                className="absolute left-0 flex w-full border-b border-line hover:bg-sunken/60"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {columns.map((c) => (
                  <div key={c.key} style={{ width: c.width }} className={cx('shrink-0 truncate px-2.5 py-1.5 text-[0.8125rem]', c.align === 'right' && 'num text-right')}>
                    {c.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
