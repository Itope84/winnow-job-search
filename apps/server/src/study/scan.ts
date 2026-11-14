import type { SourceEntry } from '@winnow/api';
import { kvGet, kvSet } from '../db.ts';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { captureJd } from '../scan/capture.ts';
import { Intake } from '../scan/intake.ts';
import { finishScan } from '../scan/portals.ts';
import { canonicalUrl, clip, sha1 } from '../util.ts';
import { recordCoverage } from './coverage.ts';
import { ERASMUS_CATALOGUE, matches, readCatalogue, subjectStems } from './erasmus.ts';
import { fetchFeed, studyRelevant } from './feeds.ts';
import { getStudy } from './mode.ts';
import { guessKind, seedOpportunity } from './opportunity.ts';

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v ? [v] : [];

export type StudySourceKind = 'page' | 'feed' | 'erasmus';

/** What a Find source is in scholarships mode. */
export function studySourceKind(e: SourceEntry): StudySourceKind | null {
  if (e.provider === 'rss') return 'feed';
  if (e.provider === 'erasmus-mundus') return 'erasmus';
  if (e.careers_url) return 'page';
  return null;
}

/** A page's text, reduced so cookie banners and dates in footers don't count as a change. */
const pageHash = (text: string) =>
  sha1(
    text
      .toLowerCase()
      .replace(/\b\d{1,2}:\d{2}\b/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 20_000),
  );

/**
 * The free scholarships scan: every watched scheme and university page (added the first time, re-read
 * after, with a change bringing it back for triage), every news feed, and the Erasmus Mundus catalogue.
 * No AI here; triage reads what comes in.
 */
export async function scanStudySources(ctx: RunCtx): Promise<RunOutput> {
  const sources = getSources(ctx.space.db);
  const study = getStudy(ctx.space.db);
  const entries = [...sources.companies, ...sources.boards].filter(
    (e) => e.enabled !== false && studySourceKind(e),
  );
  if (!entries.length)
    throw new Error('Nothing to scan. Add scholarship pages or feeds in Find › Sources.');
  const jobs = ctx.space.jobs;
  const intake = new Intake(ctx.space.db, jobs, sources.rules, ctx.run.id);
  const changed: string[] = [];
  const errors: { name: string; error: string }[] = [];
  let done = 0;
  ctx.progress(0, entries.length, 'sources');

  for (const entry of entries) {
    if (ctx.signal.aborted) throw new Error('Cancelled');
    const kind = studySourceKind(entry);
    const before = intake.stats.added.length;
    try {
      if (kind === 'feed') {
        ctx.step(`Reading ${entry.name}`);
        const items = await fetchFeed(String(entry.api ?? entry.careers_url));
        const useful = items.filter((i) => studyRelevant(i, study.level.toLowerCase()));
        for (const i of useful) {
          const k = guessKind(i.title);
          intake.add(
            {
              url: i.url,
              title: i.title,
              description: i.description,
              postedAt: i.publishedAt,
              kind: k,
              opportunity: seedOpportunity(k),
            },
            entry.name,
          );
        }
        recordCoverage(ctx.space.db, 'feed', entry.name, {
          found: items.length,
          added: intake.stats.added.length - before,
          note: `${useful.length} of ${items.length} about funded study`,
        });
      } else if (kind === 'erasmus') {
        ctx.step('Reading the Erasmus Mundus catalogue');
        const all = await readCatalogue(String(entry.careers_url ?? ERASMUS_CATALOGUE), (p, of) =>
          ctx.step(`Erasmus Mundus catalogue, page ${p} of ${of}`),
        );
        const stems = subjectStems(entry, study.subjects);
        const fit = all.filter((p) => matches(p.title, stems));
        for (const p of fit)
          intake.add(
            {
              url: p.url,
              title: p.title,
              company: 'Erasmus Mundus consortium',
              location: 'Europe (several countries)',
              kind: 'programme',
              opportunity: seedOpportunity('programme', {
                shape: 'built_in',
                funding: 'full',
                covers: 'Scholarship holders get tuition, a monthly allowance and travel costs.',
                countries: ['Europe'],
                level: 'Master’s',
                subject: p.title,
              }),
            },
            entry.name,
          );
        recordCoverage(ctx.space.db, 'scheme', entry.name, {
          found: all.length,
          added: intake.stats.added.length - before,
          note: `${fit.length} of ${all.length} programmes match your subjects${stems.length ? ` (${stems.join(', ')})` : ''}`,
        });
      } else {
        ctx.step(`Checking ${entry.name}`);
        const url = String(entry.careers_url);
        const got = await captureJd(url, { lenient: true });
        if (!got || got.text.length < 200) throw new Error('The page had no text to read.');
        const key = `watch:${canonicalUrl(url)}`;
        const hash = pageHash(got.text);
        const prev = kvGet<{ hash: string } | null>(ctx.space.db, key, null);
        kvSet(ctx.space.db, key, { hash, at: new Date().toISOString() });
        const existing = jobs.byUrl(url);
        const university = entry.kind === 'university';
        let note = '';
        if (!existing) {
          intake.add(
            {
              url,
              title: entry.name,
              company: university
                ? entry.name.replace(
                    /\s+(international\s+)?(scholarships?|funding|awards?|grants?).*$/i,
                    '',
                  )
                : '',
              location: list(entry.countries).join(', '),
              description: got.text,
              kind: 'scholarship',
              opportunity: seedOpportunity('scholarship', {
                shape: university ? 'one_school' : null,
                countries: list(entry.countries),
              }),
            },
            entry.name,
          );
          note = 'Added';
        } else if (prev && prev.hash !== hash) {
          jobs.writeJd(existing.id, got.text);
          jobs.log(existing.id, 'posting', 'The page changed since the last scan', ctx.run.id);
          if (existing.list === 'archive' && existing.archiveReason === 'closed')
            jobs.restore([existing.id]);
          if (existing.list !== 'applied') changed.push(existing.id);
          note = 'Changed: read again';
        } else note = got.closed ? `Unchanged · page says “${clip(got.closed, 60)}”` : 'Unchanged';
        recordCoverage(ctx.space.db, university ? 'university' : 'scheme', entry.name, {
          found: 1,
          added: intake.stats.added.length - before,
          note,
        });
      }
    } catch (e) {
      const msg = clip((e as Error).message, 200);
      errors.push({ name: entry.name, error: msg });
      ctx.log('stderr', `${entry.name}: ${msg}`);
      recordCoverage(
        ctx.space.db,
        kind === 'feed' ? 'feed' : entry.kind === 'university' ? 'university' : 'scheme',
        entry.name,
        { found: 0, added: 0, note: `Couldn’t read it: ${msg}` },
      );
    }
    ctx.progress(++done, entries.length, 'sources');
  }

  const out = await finishScan(ctx, intake, { errors, changed: changed.length });
  if (changed.length) {
    try {
      ctx.enqueue({ kind: 'triage', jobIds: changed });
    } catch (e) {
      ctx.log('stderr', `Could not queue triage for changed pages: ${(e as Error).message}`);
    }
  }
  return changed.length
    ? { ...out, summary: `${out.summary} · ${changed.length} pages changed` }
    : out;
}
