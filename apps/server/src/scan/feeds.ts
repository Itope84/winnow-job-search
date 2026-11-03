import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CompanyFeed, Job, SeenCompany, SourceEntry } from '@winnow/api';
import { kvGet, kvSet } from '../db.ts';
import { getSettings, getSources } from '../library.ts';
import type { Space } from '../space.ts';
import { boardOf, firstPage, fromDirectories, namesFor } from './find-portal.ts';
import { resolveEntry } from './providers.ts';

/**
 * Which job feed each company uses, learned from the jobs people see: a job's own link on a job system
 * names the company's board; failing that, the company's name in the job system directories, kept only
 * when one of the jobs seen is in that feed. One store for the server, since it holds facts about
 * companies, never who saw them. Each company is looked up once and checked again after a while.
 */

const FOUND_DAYS = 30;
const NONE_DAYS = 14;
/** Boards and aggregators: a link there names no employer. */
const NOT_EMPLOYERS = new Set([
  'linkedin',
  'freehire',
  'adzuna',
  'careerjet',
  'remotive',
  'remoteok',
]);
/** Recruitment agencies and job aggregators that post for other companies. */
const AGENCIES =
  /\b(recruit\w*|staffing|talent (partners|solutions)|search partners|headhunt\w*|jobgether|hays|randstad|adecco|reed|michael page|robert half|robert walters|harnham|oliver bernard|g2i|turing|toptal|crossover|hired|jobot|cybercoders|teksystems|kforce|insight global|motion recruitment)\b/i;

/** A job system's slug as a name: "horizon3ai" → "Horizon3ai"; a real name stays as it is. */
const displayName = (name: string) =>
  name === name.toLowerCase() && !/\s/.test(name)
    ? name.charAt(0).toUpperCase() + name.slice(1)
    : name;

export const companyKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|plc|gmbh|corp(oration)?|co)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');

interface Row {
  key: string;
  company: string;
  status: 'found' | 'none';
  entry: string | null;
  provider: string | null;
  how: string | null;
  checked_at: string;
}

let store: DatabaseSync | null = null;
let cacheDir = '';

/** Open the server's feed store; `atsCache` is where the full ATS scan keeps the company directories. */
export function openFeeds(stateDir: string, atsCache: string) {
  store = new DatabaseSync(join(stateDir, 'feeds.db'));
  store.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS company_feeds (
      key TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      status TEXT NOT NULL,
      entry TEXT,
      provider TEXT,
      how TEXT,
      checked_at TEXT NOT NULL
    );
  `);
  cacheDir = atsCache;
}

function stored(key: string): Row | null {
  return (
    (store?.prepare('SELECT * FROM company_feeds WHERE key = ?').get(key) as Row | undefined) ??
    null
  );
}

const asFeed = (r: Row | null): CompanyFeed | null =>
  r?.status === 'found' && r.entry && r.provider
    ? {
        company: r.company,
        entry: JSON.parse(r.entry) as SourceEntry,
        provider: r.provider,
        how: r.how === 'name' ? 'name' : 'link',
      }
    : null;

function fresh(r: Row | null): boolean {
  if (!r) return false;
  const days = r.status === 'found' ? FOUND_DAYS : NONE_DAYS;
  return Date.now() - Date.parse(r.checked_at) < days * 86_400_000;
}

function save(key: string, company: string, feed: Omit<CompanyFeed, 'company'> | null) {
  store
    ?.prepare(
      `INSERT INTO company_feeds (key, company, status, entry, provider, how, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET company = excluded.company, status = excluded.status,
         entry = excluded.entry, provider = excluded.provider, how = excluded.how, checked_at = excluded.checked_at`,
    )
    .run(
      key,
      company,
      feed ? 'found' : 'none',
      feed ? JSON.stringify(feed.entry) : null,
      feed?.provider ?? null,
      feed?.how ?? null,
      new Date().toISOString(),
    );
}

const squashTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Look a company's feed up from its jobs: their own links first, then its name with a job to prove it. */
async function lookUp(company: string, jobs: Job[]): Promise<Omit<CompanyFeed, 'company'> | null> {
  const links = [
    ...new Set(jobs.flatMap((j) => [j.url, ...j.sources.map((s) => s.url)]).map(boardOf)),
  ];
  for (const url of links.slice(0, 6)) {
    const entry: SourceEntry = { name: company, careers_url: url };
    const hit = await resolveEntry(entry);
    if ('error' in hit || NOT_EMPLOYERS.has(hit.provider.id)) continue;
    if (await firstPage(entry))
      return { entry: { ...entry, enabled: true }, provider: hit.provider.id, how: 'link' };
  }
  const titles = new Set(jobs.map((j) => squashTitle(j.role)));
  for (const entry of (await fromDirectories(cacheDir, namesFor('', [company]))).slice(0, 4)) {
    const hit = await resolveEntry(entry);
    if ('error' in hit) continue;
    const page = await firstPage(entry);
    if (page?.some((t) => titles.has(squashTitle(t))))
      return {
        entry: { ...entry, name: company, enabled: true },
        provider: hit.provider.id,
        how: 'name',
      };
  }
  return null;
}

/** Whether a person already tracks this company or this feed. */
function tracked(space: Space, company: string, feed: CompanyFeed | null): boolean {
  const key = companyKey(company);
  const link = feed ? String(feed.entry.api ?? feed.entry.careers_url ?? '') : '';
  return getSources(space.db).companies.some(
    (c) => companyKey(c.name) === key || (!!link && (c.careers_url === link || c.api === link)),
  );
}

const dismissed = (space: Space) => new Set(kvGet<string[]>(space.db, 'feeds_dismissed', []));

export function dismissFeed(space: Space, company: string) {
  kvSet(space.db, 'feeds_dismissed', [...dismissed(space), companyKey(company)]);
}

/** A job that says something about the person's interest: not one their rules or triage threw out. */
const counts = (job: Job) =>
  !(job.list === 'archive' && ['rules', 'triage'].includes(job.archiveReason ?? ''));

/** Jobs grouped by company, with how many look like agency postings. */
function byCompany(space: Space): Map<string, { company: string; jobs: Job[]; agency: number }> {
  const out = new Map<string, { company: string; jobs: Job[]; agency: number }>();
  for (const job of space.jobs.all().filter(counts)) {
    const key = companyKey(job.company);
    if (!key || job.company === '?') continue;
    const g = out.get(key) ?? { company: displayName(job.company), jobs: [], agency: 0 };
    g.jobs.push(job);
    if (job.triage?.agency) g.agency++;
    out.set(key, g);
  }
  return out;
}

const isAgency = (g: { company: string; jobs: Job[]; agency: number }) =>
  AGENCIES.test(g.company) || (g.agency * 2 >= g.jobs.length && g.agency > 0);

/**
 * Look up the feeds of companies seen in these jobs that the person doesn't track, at most `limit`
 * companies, skipping agencies and companies looked up recently.
 */
export async function learnFeeds(space: Space, jobIds?: string[], limit = 15): Promise<number> {
  if (!store) return 0;
  const groups = byCompany(space);
  const wanted = jobIds
    ? new Set(jobIds.map((id) => companyKey(space.jobs.get(id)?.company ?? '')))
    : new Set(groups.keys());
  let looked = 0;
  // Most-seen companies first: they're the ones worth suggesting.
  for (const [key, g] of [...groups].sort((a, b) => b[1].jobs.length - a[1].jobs.length)) {
    if (looked >= limit) break;
    if (!wanted.has(key) || isAgency(g) || fresh(stored(key)) || tracked(space, g.company, null))
      continue;
    looked++;
    save(key, g.company, await lookUp(g.company, g.jobs).catch(() => null));
  }
  return looked;
}

/** The feed to offer on a job's page: its company's, when known, untracked, not dismissed or an agency. */
export async function feedForJob(space: Space, job: Job): Promise<CompanyFeed | null> {
  const key = companyKey(job.company);
  if (!store || !key || dismissed(space).has(key)) return null;
  const g = byCompany(space).get(key);
  if (!g || isAgency(g)) return null;
  let row = stored(key);
  if (!fresh(row)) {
    save(key, g.company, await lookUp(g.company, g.jobs).catch(() => null));
    row = stored(key);
  }
  const feed = asFeed(row);
  return feed && !tracked(space, job.company, feed) ? { ...feed, company: g.company } : null;
}

/** Untracked companies seen often (3+ jobs) or scored well (Apply band or above), with known feeds. */
export function seenCompanies(space: Space): SeenCompany[] {
  if (!store) return [];
  const apply = getSettings(space.db).bands.apply;
  const skip = dismissed(space);
  const out: SeenCompany[] = [];
  for (const [key, g] of byCompany(space)) {
    if (skip.has(key) || isAgency(g)) continue;
    const scores = g.jobs
      .map((j) => j.score?.score)
      .filter((s): s is number => typeof s === 'number');
    const bestScore = scores.length ? Math.max(...scores) : null;
    if (g.jobs.length < 3 && (bestScore === null || bestScore < apply)) continue;
    const feed = asFeed(stored(key));
    if (!feed || tracked(space, g.company, feed)) continue;
    out.push({ feed: { ...feed, company: g.company }, jobs: g.jobs.length, bestScore });
  }
  return out.sort(
    (a, b) =>
      Number((b.bestScore ?? 0) >= apply) - Number((a.bestScore ?? 0) >= apply) || b.jobs - a.jobs,
  );
}
