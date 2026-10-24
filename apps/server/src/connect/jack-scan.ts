import { getSources } from '../library.ts';
import type { Executor, RunCtx } from '../runs/runner.ts';
import { Intake, type Offer } from '../scan/intake.ts';
import { finishScan } from '../scan/portals.ts';
import { clip } from '../util.ts';
import { type JackLink, structured } from './jack.ts';

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

/**
 * Jack scan: the Jill roles on the person's radar, then Jack's public search on their saved brief. No AI
 * of ours; Jack does the matching. Jill roles skip every rule: Jill already matched them to the person.
 */
export function jackScan(jack: JackLink): Executor {
  return async (ctx: RunCtx) => {
    const db = ctx.space.db;
    if (!jack.status(db).connected)
      throw new Error('Connect your Jack account first, in You › Jack & Jill.');
    const intake = new Intake(db, ctx.space.jobs, getSources(db).rules, ctx.run.id);
    const notes: string[] = [];
    ctx.progress(0, 2, 'steps');

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
    ctx.progress(1, 2, 'steps');

    let searched = 0;
    const account = structured(await jack.call(db, 'get_account_status'));
    const brief = (account.search_brief ?? {}) as { is_empty?: boolean };
    if (brief.is_empty) {
      notes.push(
        'Search skipped: your Jack search brief is empty. Send it from You › Jack & Jill.',
      );
    } else if (!ctx.signal.aborted) {
      ctx.step('Searching public jobs on your Jack brief');
      let search = structured(await jack.call(db, 'search_jobs', { query: 'Search on the brief' }));
      const started = Date.now();
      while (
        search.status === 'running' &&
        typeof search.search_id === 'string' &&
        !ctx.signal.aborted &&
        Date.now() - started < SEARCH_WAIT_MS
      )
        search = structured(
          await jack.call(db, 'get_search_status', { search_id: search.search_id }),
        );
      if (search.status === 'running')
        notes.push('Jack’s search was still running; its results come next time.');
      const jobs = Array.isArray(search.jobs) ? (search.jobs as SearchJob[]) : [];
      for (const job of jobs) {
        const offer = searchOffer(job);
        if (offer) intake.add(offer, 'jack');
      }
      searched = jobs.length;
    }
    if (ctx.signal.aborted) throw new Error('Cancelled');
    for (const n of notes) ctx.log('info', n);
    ctx.progress(2, 2, 'steps');
    const out = await finishScan(ctx, intake, { radar: roles.length, searched, notes });
    return notes.length ? { ...out, summary: `${out.summary} · ${clip(notes[0] ?? '', 90)}` } : out;
  };
}
