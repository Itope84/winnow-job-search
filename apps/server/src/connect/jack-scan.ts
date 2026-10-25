import { getSources } from '../library.ts';
import type { Executor, RunCtx } from '../runs/runner.ts';
import { Intake, type Offer } from '../scan/intake.ts';
import { finishScan } from '../scan/portals.ts';
import { clip, HttpError } from '../util.ts';
import { type JackLink, structured } from './jack.ts';
import { markSearched } from './jack-auto.ts';

/** How long to keep collecting a running Jack search. */
const SEARCH_WAIT_MS = 6 * 60_000;

interface RadarRole {
  title?: string;
  company?: string | null;
  location?: string | null;
  pitch?: string | null;
  posted_at?: string | null;
  jack_url?: string | null;
}

interface SearchJob {
  title?: string;
  company?: string | null;
  location?: string | null;
  salary?: string | null;
  why_it_fits?: string | null;
  posted_at?: string | null;
  posting_url?: string | null;
  jack_url?: string | null;
}

const MONTHS =
  'january february march april may june july august september october november december';

/** Jack's dates: ISO, or prose like "Tuesday the 6th of October 2026 at 12:00 AM". */
export function jackDate(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const iso = Date.parse(text);
  if (Number.isFinite(iso)) return iso;
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([a-z]+)\s+(\d{4})/i.exec(text);
  const month = m ? MONTHS.split(' ').indexOf((m[2] ?? '').toLowerCase()) : -1;
  if (!m || month < 0) return undefined;
  return Date.UTC(Number(m[3]), month, Number(m[1]));
}

/** A Jill role. Its title often carries pay and the company ("Product Engineer (£70k–£185k) at Omnea"). */
export function radarOffer(role: RadarRole): Offer | null {
  if (!role.title || !role.jack_url) return null;
  let title = role.title.trim();
  const company = (role.company ?? '').trim();
  if (company && title.toLowerCase().endsWith(` at ${company.toLowerCase()}`))
    title = title.slice(0, -(company.length + 4)).trim();
  const pay = /\s*\(([^()]*[£$€][^()]*)\)/.exec(title);
  if (pay) title = title.replace(pay[0], '').trim();
  return {
    title,
    url: role.jack_url,
    company,
    location: role.location ?? '',
    description: role.pitch ?? undefined,
    postedAt: jackDate(role.posted_at),
    salary: pay?.[1] ? { text: pay[1] } : undefined,
  };
}

/** A public posting Jack found. The employer's own link, so the same job from a company scan merges. */
export function searchOffer(job: SearchJob): Offer | null {
  const url = job.posting_url || job.jack_url;
  if (!job.title || !url) return null;
  return {
    title: job.title.trim(),
    url,
    company: (job.company ?? '').trim(),
    location: job.location ?? '',
    description: job.why_it_fits ?? undefined,
    postedAt: jackDate(job.posted_at),
    salary: job.salary ? { text: job.salary } : undefined,
  };
}

/** Most searches one scan runs: the general pass plus one per target role. */
const MAX_SEARCHES = 8;

/**
 * What to search for: a general pass on the brief, then one search per target role in it, so a scan
 * sees more than one search's ten results. Jack adds the saved brief to every query.
 */
export function searchQueries(brief: {
  role_titles?: unknown;
  locations?: unknown;
  work_modes?: unknown;
}): string[] {
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  const places = list(brief.locations);
  const remote = list(brief.work_modes).includes('remote');
  const where = [places.join(' or '), remote ? 'remote' : ''].filter(Boolean).join(', or ');
  const roles = [...new Set(list(brief.role_titles).map((t) => t.trim()))];
  return [
    'Search on the brief',
    ...roles.map((t) => (where ? `${t} roles in ${where}` : `${t} roles`)),
  ].slice(0, MAX_SEARCHES);
}

/** One Jack search, collected to the end (Jack runs one at a time per person). */
async function runSearch(
  jack: JackLink,
  ctx: RunCtx,
  query: string,
): Promise<{ jobs: SearchJob[]; running: boolean }> {
  const db = ctx.space.db;
  let search = structured(await jack.call(db, 'search_jobs', { query }));
  const started = Date.now();
  while (
    search.status === 'running' &&
    typeof search.search_id === 'string' &&
    !ctx.signal.aborted &&
    Date.now() - started < SEARCH_WAIT_MS
  )
    search = structured(await jack.call(db, 'get_search_status', { search_id: search.search_id }));
  return {
    jobs: Array.isArray(search.jobs) ? (search.jobs as SearchJob[]) : [],
    running: search.status === 'running',
  };
}

/**
 * Jack scan: the Jill roles on the person's radar, then Jack's public search on their saved brief, once in
 * general and once per target role. No AI of ours; Jack does the matching. Jill roles skip every rule:
 * Jill already matched them to the person.
 */
export function jackScan(jack: JackLink): Executor {
  return async (ctx: RunCtx) => {
    const db = ctx.space.db;
    if (!jack.status(db).connected)
      throw new Error('Connect your Jack account first, in You › Jack & Jill.');
    const intake = new Intake(db, ctx.space.jobs, getSources(db).rules, ctx.run.id);
    const notes: string[] = [];
    ctx.progress(0, 1, 'steps');

    ctx.step('Reading the Jill roles on your radar');
    let radar = structured(await jack.call(db, 'get_radar_roles'));
    if (radar.status === 'pending') radar = structured(await jack.call(db, 'get_radar_roles'));
    const roles = Array.isArray(radar.roles) ? (radar.roles as RadarRole[]) : [];
    for (const role of roles) {
      const offer = radarOffer(role);
      if (offer) intake.add(offer, 'jill', '', { skipRules: true });
    }
    if (radar.status === 'visibility_required')
      notes.push('Jill roles need you visible on Jack (Jack › Settings).');
    else if (radar.status === 'pending') notes.push('Jack was still checking Jill roles.');

    let searched = 0;
    let searches = 0;
    // The automatic check reads only the radar; searches run on their own, slower cadence.
    const radarOnly = ctx.runs.params(ctx.run.id).radarOnly === true;
    const briefRaw = radarOnly ? {} : structured(await jack.call(db, 'get_search_brief'));
    const completeness = (briefRaw.completeness ?? {}) as { is_empty?: boolean };
    const queries =
      radarOnly || completeness.is_empty
        ? []
        : searchQueries((briefRaw.brief ?? {}) as Record<string, unknown>);
    if (!radarOnly && !queries.length)
      notes.push(
        'Search skipped: your Jack search brief is empty. Send it from You › Jack & Jill.',
      );
    if (queries.length) markSearched(db);
    ctx.progress(1, 1 + queries.length, 'steps');
    for (const [i, query] of queries.entries()) {
      if (ctx.signal.aborted) break;
      ctx.step(
        i === 0 ? 'Searching public jobs on your Jack brief' : `Searching Jack: ${clip(query, 80)}`,
      );
      try {
        const { jobs, running } = await runSearch(jack, ctx, query);
        if (running) notes.push(`Jack’s search “${clip(query, 60)}” was still running.`);
        for (const job of jobs) {
          const offer = searchOffer(job);
          if (offer) intake.add(offer, 'jack');
        }
        searched += jobs.length;
        searches++;
      } catch (e) {
        if (e instanceof HttpError && e.code === 'jack_signed_out') throw e;
        // One search failing (a limit, a timeout) doesn't lose the others.
        ctx.log('stderr', `Search “${query}”: ${(e as Error).message}`);
        notes.push(`A Jack search failed: ${clip((e as Error).message, 80)}`);
      }
      ctx.progress(2 + i, 1 + queries.length, 'steps');
    }
    if (ctx.signal.aborted) throw new Error('Cancelled');
    for (const n of notes) ctx.log('info', n);
    const out = await finishScan(ctx, intake, { radar: roles.length, searches, searched, notes });
    return notes.length ? { ...out, summary: `${out.summary} · ${clip(notes[0] ?? '', 90)}` } : out;
  };
}
