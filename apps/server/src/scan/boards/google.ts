import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';

/**
 * Google's jobs site (Google, DeepMind, Waymo, Wing…). Its results page carries the jobs as data in the
 * HTML, 20 a page. Google has thousands of jobs, so the entry's link decides what is read: the same link
 * as a Google search, `https://www.google.com/about/careers/applications/jobs/results/?location=London%2C%20UK&q=…`.
 * Every filter in that link (location, q, target_level, employment_type…) is kept.
 */
const PATH = '/about/careers/applications/jobs/results';
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 100;

/** The results link an entry describes, without a page number, or null. */
export function googleSearch(entry: SourceEntry): URL | null {
  try {
    const u = new URL(String(entry.api ?? entry.careers_url ?? ''));
    if (u.protocol !== 'https:' || u.hostname !== 'www.google.com') return null;
    if (!u.pathname.replace(/\/$/, '').endsWith(PATH)) return null;
    const out = new URL(`https://www.google.com${PATH}/`);
    for (const [k, v] of u.searchParams) if (k !== 'page') out.searchParams.append(k, v);
    return out;
  } catch {
    return null;
  }
}

type GoogleJob = unknown[];
const text = (v: unknown) => (Array.isArray(v) && typeof v[1] === 'string' ? v[1] : '');

/** The jobs and the total from a results page's `ds:1` data block. */
export function googlePage(html: string): { jobs: GoogleJob[]; total: number } {
  const m = /AF_initDataCallback\(\{key: 'ds:1'[\s\S]*?data:([\s\S]*?), sideChannel/.exec(html);
  if (!m?.[1])
    throw new Error('google: the results page had no job data (the site may have changed)');
  const data = JSON.parse(m[1]) as unknown[];
  const jobs = Array.isArray(data[0]) ? (data[0] as GoogleJob[]) : [];
  return { jobs, total: typeof data[2] === 'number' ? data[2] : jobs.length };
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function googleOffer(job: GoogleJob): Offer | null {
  const id = typeof job[0] === 'string' ? job[0] : '';
  const title = typeof job[1] === 'string' ? job[1].trim() : '';
  if (!id || !title) return null;
  const places = Array.isArray(job[9])
    ? (job[9] as unknown[][]).map((l) => String(l?.[0] ?? '')).filter(Boolean)
    : [];
  const created = Array.isArray(job[12]) ? Number(job[12][0]) : Number.NaN;
  const description = [
    text(job[10]),
    text(job[3]) && `<h3>Responsibilities</h3>${text(job[3])}`,
    text(job[4]),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    title,
    url: `https://www.google.com${PATH}/${id}-${slug(title)}`,
    company: typeof job[7] === 'string' && job[7] ? job[7] : 'Google',
    location: places.join(' · '),
    description: description || undefined,
    postedAt: Number.isFinite(created) && created > 0 ? created * 1000 : undefined,
  };
}

export const google: Provider = {
  id: 'google',
  detect(entry) {
    const u = googleSearch(entry);
    return u ? { url: u.toString() } : null;
  },
  async fetch(entry, ctx) {
    const search = googleSearch(entry);
    if (!search) throw new Error('google: the link must be a Google Careers results page');
    const http = ctx as HttpCtx;
    const pages = Math.min(
      Math.max(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 1),
      HARD_MAX_PAGES,
    );
    const offers: BoardOffers = [];
    for (let page = 1; page <= pages; page++) {
      const url = new URL(search);
      if (page > 1) url.searchParams.set('page', String(page));
      const { jobs, total } = googlePage(
        await http.fetchText(url.toString(), { redirect: 'error', timeoutMs: 30_000 }),
      );
      for (const job of jobs) {
        const offer = googleOffer(job);
        if (offer) offers.push(offer);
      }
      if (jobs.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
      if (page === pages)
        offers.note = `Google: read ${offers.length} of ${total} jobs; narrow the link's search or raise max_pages`;
    }
    return offers;
  },
};
