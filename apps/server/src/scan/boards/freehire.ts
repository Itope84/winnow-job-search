import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';

/** freehire.me's agent search: postings from about 50 job systems, each with its full text. */
const API = 'https://freehire.me/api/v1/agent/jobs/search';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

interface FreehireJob {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string | null;
  posted_at?: string | null;
  closed_at?: string | null;
  enrichment?: {
    salary_min?: number | null;
    salary_max?: number | null;
    salary_currency?: string | null;
    salary_period?: string | null;
  } | null;
}

interface FreehirePage {
  data?: FreehireJob[];
  meta?: { total?: number; ignored_params?: { param: string }[] };
}

/** A list field as the entry may hold it: an array, or text split on commas. */
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map((x) => String(x).trim())
    .filter(Boolean);

/**
 * The search for one entry. Fields: `keywords` (freehire's own syntax: `OR` between alternatives,
 * `title:` to match titles only), `countries` (ISO codes such as `gb`), `regions`, `cities`,
 * `seniority`, `work_mode`, `posted_within_days`.
 */
export function freehireParams(entry: SourceEntry, page: number): URLSearchParams {
  const p = new URLSearchParams();
  const q = typeof entry.keywords === 'string' ? entry.keywords.trim() : '';
  if (q) p.set('q', q);
  p.set('limit', String(PAGE_SIZE));
  p.set('offset', String(page * PAGE_SIZE));
  p.set('description_format', 'markdown');
  const days = Number(entry.posted_within_days);
  if (Number.isFinite(days) && days > 0) p.set('posted_within_days', String(Math.round(days)));
  const mode = list(entry.work_mode).join(',');
  if (mode) p.set('work_mode', mode);
  for (const [param, field] of [
    ['countries', 'countries'],
    ['regions', 'regions'],
    ['cities', 'cities'],
    ['seniority', 'seniority'],
  ] as const)
    for (const v of list(entry[field]))
      p.append(param, param === 'countries' ? v.toLowerCase() : v);
  return p;
}

export function freehireOffer(job: FreehireJob): Offer | null {
  if (!job.title?.trim() || !job.url || job.closed_at) return null;
  const e = job.enrichment ?? {};
  const yearly = !e.salary_period || e.salary_period === 'year';
  const posted = job.posted_at ? Date.parse(job.posted_at) : Number.NaN;
  return {
    title: job.title.trim(),
    url: job.url,
    company: job.company?.trim() ?? '',
    location: job.location ?? '',
    description: job.description ?? undefined,
    postedAt: Number.isFinite(posted) ? posted : undefined,
    salary:
      yearly && (e.salary_min || e.salary_max)
        ? { min: e.salary_min ?? null, max: e.salary_max ?? null, currency: e.salary_currency }
        : undefined,
  };
}

export const freehire: Provider = {
  id: 'freehire',
  async fetch(entry, ctx) {
    const http = ctx as HttpCtx;
    const pages = Math.min(Math.max(Number(entry.max_pages) || 1, 1), MAX_PAGES);
    const offers: BoardOffers = [];
    for (let page = 0; page < pages; page++) {
      const res = (await http.fetchJson(`${API}?${freehireParams(entry, page)}`, {
        redirect: 'error',
        timeoutMs: 30_000,
      })) as FreehirePage;
      const ignored = res.meta?.ignored_params?.map((x) => x.param) ?? [];
      if (ignored.length) offers.note = `freehire ignored ${ignored.join(', ')}`;
      const jobs = res.data ?? [];
      for (const job of jobs) {
        const offer = freehireOffer(job);
        if (offer) offers.push(offer);
      }
      if (jobs.length < PAGE_SIZE) break;
    }
    return offers;
  },
};
