import { Check, ChevronDown, Info, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/* ---------------- Button ---------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent/90',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'border border-bad/40 bg-surface text-bad hover:bg-bad/10',
        className,
      )}
    />
  );
}

/* ---------------- Panel ---------------- */

export function Panel({
  title, subtitle, actions, children, className, flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cx('rounded-md border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-3.5'}>{children}</div>
    </section>
  );
}

/* ---------------- Badge ---------------- */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-2xs font-medium leading-4',
        tone === 'neutral' && 'bg-sunken text-ink-2',
        tone === 'good' && 'bg-good/10 text-good',
        tone === 'warn' && 'bg-warn/10 text-warn',
        tone === 'bad' && 'bg-bad/10 text-bad',
        tone === 'accent' && 'bg-accent-soft text-accent',
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- InfoTip (hover / focus definition) ---------------- */

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="How this is calculated"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="rounded-full text-ink-3 hover:text-ink-2"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-1 w-64 -translate-x-1/2 whitespace-normal rounded border border-line-strong bg-surface p-2 text-left text-xs font-normal leading-snug text-ink-2 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  title, children, footer, onClose, wide,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:pt-[10vh]" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('w-full rounded-md border border-line-strong bg-surface shadow-xl outline-none', wide ? 'max-w-3xl' : 'max-w-md')}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="px-4 py-3.5 text-sm">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onClose, danger,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

/* ---------------- Segmented control ---------------- */

export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-line-strong bg-surface p-px">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-6 rounded-sm px-2 text-xs font-medium',
            value === o.value ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-sunken',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs<T extends string>({
  value, onChange, tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex gap-4 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-0.5 pb-2 pt-1 text-sm font-medium',
            value === t.value ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="num ml-1.5 text-xs text-ink-3">{t.count.toLocaleString('en-IN')}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Multi-select with search ---------------- */

export function MultiSelect({
  label, options, selected, onChange, render, placeholder = 'All', searchable = true,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  render?: (v: string) => string;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const text = (v: string) => (render ? render(v) : v);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? options.filter((o) => text(o).toLowerCase().includes(needle)) : options;
    return list.slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, options]);
  const sel = new Set(selected);
  const toggle = (v: string) => onChange(sel.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? placeholder : selected.length === 1 ? text(selected[0]) : `${selected.length} selected`;
  return (
    <div ref={ref} className="relative">
      <span className="label">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
        className={cx('field flex items-center justify-between gap-1 text-left', selected.length === 0 && 'text-ink-3')}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 max-w-[80vw] rounded border border-line-strong bg-surface shadow-lg">
          {searchable && options.length > 8 && (
            <div className="flex items-center gap-1.5 border-b border-line px-2">
              <Search size={13} className="text-ink-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
                aria-label={`Search ${label}`}
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-ink-3"
              />
            </div>
          )}
          <ul role="listbox" aria-multiselectable="true" className="max-h-60 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-2.5 py-1.5 text-xs text-ink-3">No matches</li>}
            {shown.map((o) => (
              <li key={o} role="option" aria-selected={sel.has(o)}>
                <button type="button" onClick={() => toggle(o)} className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-sm hover:bg-sunken">
                  <span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border', sel.has(o) ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
                    {sel.has(o) && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="truncate">{text(o)}</span>
                </button>
              </li>
            ))}
            {options.length > shown.length && !q && <li className="px-2.5 py-1 text-xs text-ink-3">Showing first 300. Search to narrow.</li>}
          </ul>
          {selected.length > 0 && (
            <div className="border-t border-line p-1">
              <button type="button" onClick={() => onChange([])} className="w-full rounded px-2 py-1 text-left text-xs text-ink-2 hover:bg-sunken">
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- States ---------------- */

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'neutral', children, onDismiss }: { tone?: Tone; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2 rounded border px-3 py-2 text-xs leading-relaxed',
        tone === 'neutral' && 'border-line bg-sunken text-ink-2',
        tone === 'accent' && 'border-accent/20 bg-accent-soft text-ink',
        tone === 'good' && 'border-good/30 bg-good/5 text-ink',
        tone === 'warn' && 'border-warn/40 bg-warn/5 text-ink',
        tone === 'bad' && 'border-bad/40 bg-bad/5 text-ink',
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function ProgressBar({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={value === null ? undefined : Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx('h-full rounded-full bg-accent', value === null && 'w-1/3 animate-pulse')}
        style={value === null ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-snug text-ink-3">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {lead && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}
