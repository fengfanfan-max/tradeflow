/**
 * The hand-written UI kit.
 *
 * Server components by default — only `ActionForm` and `QuoteBuilder` carry
 * `'use client'`, so everything here renders on the server and ships no
 * JavaScript. Nothing in this file may import `next/headers` or the API client,
 * because the two client components import from it.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { format, type Money } from '@tradeflow/shared';
import type { InvoiceStatus, JobStatus, QuoteStatus } from '@tradeflow/shared';

/* ------------------------------------------------------------------ */
/* Money and figures                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every amount in the app goes through the shared formatter.
 *
 * `format` takes `{ amount, currency }` in minor units and is the only code that
 * divides by 100 — so a pence value can never be rendered as pounds, and a total
 * can never disagree with the API's own arithmetic.
 */
export function Amount({
  value,
  className = '',
  strong = false,
  muted = false,
}: {
  value: Money;
  className?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  const tone = strong ? 'text-ink font-semibold' : muted ? 'text-ink-dim' : 'text-ink';
  return <span className={`num ${tone} ${className}`}>{format(value)}</span>;
}

export function Figure({
  children,
  className = '',
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return <span className={`num ${muted ? 'text-ink-dim' : 'text-ink'} ${className}`}>{children}</span>;
}

/** A basis-point rate as the percentage a person reads. 2000 → "20%". */
export function taxRateLabel(taxRateBp: number): string {
  const percent = taxRateBp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-neutral-wash text-ink-dim border-line-strong',
  ok: 'bg-ok-wash text-ok border-[#1d4530]',
  warn: 'bg-warn-wash text-warn border-[#4a3a14]',
  bad: 'bg-bad-wash text-bad border-[#4d2229]',
  info: 'bg-info-wash text-info border-[#1b3d52]',
  accent: 'bg-accent-wash text-accent border-[#4d3a12]',
};

export function Pill({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const QUOTE_TONE: Record<QuoteStatus, Tone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'ok',
  DECLINED: 'bad',
  EXPIRED: 'warn',
};

const JOB_TONE: Record<JobStatus, Tone> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'accent',
  COMPLETED: 'ok',
  CANCELLED: 'neutral',
};

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PAID: 'ok',
  VOID: 'bad',
};

export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return <Pill tone={QUOTE_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Pill>;
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  return <Pill tone={JOB_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Pill>;
}

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  return <Pill tone={INVOICE_TONE[status] ?? 'neutral'}>{status}</Pill>;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; href: string }[];
}) {
  return (
    <header className="border-b border-line pb-4">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1.5 text-xs text-ink-faint">
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.href} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden>/</span>}
              <Link href={crumb.href} className="link">
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-dim">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={`panel overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-dim">{title}</p>
      {description && <p className="max-w-md text-xs text-ink-faint">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

/**
 * A label, a control and the API's own message for that field.
 *
 * The message comes straight from the `Problem.fields` map the server returned,
 * so a rule enforced in the shared Zod schema is shown against the input it
 * belongs to rather than summarised at the top of the form.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-1 text-accent">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-bad">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/** A read-only value in a detail panel. */
export function Detail({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold tracking-wider text-ink-faint uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bars                                                         */
/* ------------------------------------------------------------------ */

/**
 * Filter chips whose state is the URL.
 *
 * Each chip is a link built with `buildHref`, so the active filter is what the
 * address bar says and the view can be pasted to a colleague.
 */
export function FilterChips({
  options,
  active,
  hrefFor,
}: {
  options: { value: string; label: string; count?: number }[];
  active: string;
  hrefFor: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const selected = option.value === active;
        return (
          <Link
            key={option.value || 'all'}
            href={hrefFor(option.value)}
            aria-current={selected ? 'true' : undefined}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              selected
                ? 'border-accent bg-accent-wash text-accent'
                : 'border-line-strong bg-raised text-ink-dim hover:text-ink'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="num ml-1.5 text-[11px] opacity-70">{option.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** The `<form method="get">` search box. No JavaScript: the URL is the state. */
export function SearchBox({
  action,
  name = 'q',
  defaultValue,
  placeholder,
  hidden,
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <input
        className="control w-56"
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search'}
      />
      <button className="btn" type="submit">
        Search
      </button>
      {defaultValue ? (
        <Link className="btn btn-ghost" href={action}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}

/**
 * A sortable column heading.
 *
 * Toggles direction on the column already sorted, so a second click reverses
 * rather than doing nothing.
 */
export function SortHeader({
  label,
  field,
  activeField,
  activeDir,
  hrefFor,
  align = 'left',
}: {
  label: string;
  field: string;
  activeField: string;
  activeDir: 'asc' | 'desc';
  hrefFor: (field: string, dir: 'asc' | 'desc') => string;
  align?: 'left' | 'right';
}) {
  const isActive = field === activeField;
  const nextDir: 'asc' | 'desc' = isActive && activeDir === 'asc' ? 'desc' : 'asc';
  return (
    <th className={align === 'right' ? 'right' : undefined} aria-sort={isActive ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={hrefFor(field, nextDir)}
        className={`inline-flex items-center gap-1 ${isActive ? 'text-accent' : ''}`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {isActive ? (activeDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/**
 * A failure that happened while *reading* the page.
 *
 * Distinct from a form error, which `ActionForm` renders: this one means the
 * page has no data to show, so it replaces the content rather than sitting above
 * it.
 */
export function ErrorPanel({ title, detail, retry }: { title: string; detail: string; retry?: ReactNode }) {
  return (
    <div className="panel border-bad/40 p-4" role="alert">
      <p className="text-sm font-semibold text-bad">{title}</p>
      <p className="mt-1 text-xs text-ink-dim">{detail}</p>
      {retry && <div className="mt-3">{retry}</div>}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${TONE_CLASS[tone]}`} role="status">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

/**
 * Highlights what a status transition did to the page.
 *
 * A server action that revalidates a route leaves the operator looking at
 * identical-looking data; the flash makes the change legible.
 */
export function Flash({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-[#1d4530] bg-ok-wash px-3 py-2 text-xs font-medium text-ok" role="status">
      {children}
    </div>
  );
}
