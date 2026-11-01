import type { Job } from '@winnow/api';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Age of a posting: posted date when known (in days, since it has no time), otherwise when first seen. */
export function jobAge(job: Job): string {
  if (job.postedAt && job.postedAt.length === 10) {
    const days = Math.floor(
      (Date.now() - new Date(`${job.postedAt}T00:00:00`).getTime()) / 86_400_000,
    );
    if (days <= 0) return 'today';
    if (days < 60) return `${days}d`;
    return new Date(`${job.postedAt}T00:00:00`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  }
  return timeAgo(job.postedAt ?? job.firstSeen);
}

const dayMs = 86_400_000;
const days = (ymd: string) =>
  Math.floor((Date.now() - new Date(`${ymd}T00:00:00`).getTime()) / dayMs);

/** Posted more than 30 days ago: shown with a warning, never hidden. */
export function isStale(job: Job): boolean {
  return !!job.postedAt && job.postedAt.length >= 10 && days(job.postedAt.slice(0, 10)) > 30;
}

/** The posting's deadline, and whether it's within 7 days. */
export function deadline(job: Job): { label: string; soon: boolean } | null {
  const d = job.posting?.deadline;
  if (!d) return null;
  const left = -days(d);
  const date = new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  if (left < 0) return { label: `Closed ${date}`, soon: false };
  const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
  return { label: `Closes ${date} (${when})`, soon: left <= 7 };
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function duration(from: string | null, to: string | null): string {
  if (!from) return '';
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function money(usd: number | null | undefined): string {
  if (usd == null) return '';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/** Two-letter monogram for a company. */
export function monogram(company: string): string {
  const clean = company
    .replace(/^\?\s*(\(via\s*)?/i, '')
    .replace(/[()]/g, '')
    .trim();
  if (!clean) return '?';
  const words = clean.split(/[\s\-_.]+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  return `${clean[0]?.toUpperCase() ?? ''}${clean[1]?.toLowerCase() ?? ''}`;
}

/** Company name for display: career-ops slugs ("affirm") get a capital; "?" becomes the agency or a dash. */
export function companyLabel(company: string): string {
  const c = company.trim();
  if (!c || c === '?') return 'Unknown company';
  const via = /^\?\s*\(via\s+(.+)\)$/i.exec(c);
  if (via) return `Via ${via[1]}`;
  if (/^[a-z0-9-]+$/.test(c)) return c.charAt(0).toUpperCase() + c.slice(1);
  return c;
}
