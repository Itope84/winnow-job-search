import type { FundingLevel } from '@winnow/api';
import { FUNDING_LEVELS } from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { Intake } from '../scan/intake.ts';
import { finishScan } from '../scan/portals.ts';
import { clip } from '../util.ts';
import { placeCountries, recordCoverage } from './coverage.ts';
import { countryFacts } from './data.ts';
import { getStudy } from './mode.ts';
import { isoDate, seedOpportunity } from './opportunity.ts';
import { studyBrief } from './triage.ts';

type Raw = Record<string, unknown>;
const s = (v: unknown, max = 300) => (typeof v === 'string' ? clip(v.trim(), max) : '');

export type SearchTarget =
  | { type: 'country'; name: string }
  | { type: 'query'; name: string; query: string };

/** What AI search covers: each saved query, then each country the person prefers or allows. */
export function searchTargets(ctx: RunCtx): SearchTarget[] {
  const study = getStudy(ctx.space.db);
  const excluded = new Set(placeCountries(study.places.exclude).map((c) => c.toLowerCase()));
  const countries = placeCountries([...study.places.prefer, ...study.places.allow]).filter(
    (c) => !excluded.has(c.toLowerCase()),
  );
  return [
    ...getSources(ctx.space.db)
      .queries.filter((q) => q.enabled)
      .map((q): SearchTarget => ({ type: 'query', name: q.name, query: q.query })),
    ...countries.map((name): SearchTarget => ({ type: 'country', name })),
  ];
}

function validate(value: unknown) {
  const items = (value as { items?: unknown })?.items;
  if (!Array.isArray(items))
    throw new Error('result.json needs an "items" list (it may be empty).');
  const checked = Number((value as Raw)?.checked);
  return {
    items: (items as Raw[]).filter(
      (i) => typeof i?.url === 'string' && /^https?:\/\//.test(i.url) && s(i.title),
    ),
    checked: Number.isFinite(checked) ? Math.max(0, Math.round(checked)) : 0,
    note: s((value as Raw)?.note, 300),
  };
}

/**
 * AI search for scholarships: each saved query, then a sweep of each country in the person's places
 * (programmes in their subjects, and the funding there). Every target is recorded in coverage, so a
 * country that turned up nothing shows as checked. Picks up after the last finished target on resume.
 */
export async function studySearch(ctx: RunCtx): Promise<RunOutput> {
  const targets = searchTargets(ctx);
  if (!targets.length)
    throw new Error(
      'Nothing to search: add countries in You › Study preferences, or a query in Find › AI search queries.',
    );
  const jobs = ctx.space.jobs;
  const intake = new Intake(ctx.space.db, jobs, getSources(ctx.space.db).rules, ctx.run.id);
  const start = ctx.checkpoint<{ next: number; added: string[] }>() ?? { next: 0, added: [] };
  intake.stats.added.push(...start.added);
  const brief = studyBrief(ctx);
  ctx.progress(start.next, targets.length, 'searches');
  for (let i = start.next; i < targets.length; i++) {
    if (ctx.signal.aborted) throw new Error('Cancelled');
    const t = targets[i] as SearchTarget;
    ctx.step(t.type === 'country' ? `Searching ${t.name}` : `Searching: ${t.name}`);
    const known = jobs
      .ids("kind != 'job' AND location LIKE ? LIMIT 80", `%${t.type === 'country' ? t.name : ''}%`)
      .map((id) => jobs.get(id))
      .filter((j) => !!j)
      .map((j) => `${j.role} · ${j.company}`);
    const before = intake.stats.added.length;
    try {
      const { value } = await runSkill(ctx, {
        skill: 'scholarship-search',
        folder: `${ctx.run.id}/target-${i + 1}`,
        input: {
          target: t,
          country: t.type === 'country' ? countryFacts(t.name) : null,
          candidate: brief.brief,
          known,
          max: 10,
        },
        files: brief.files,
        task:
          t.type === 'country'
            ? `Find funded master's options in ${t.name} that fit the candidate.`
            : `Run the search "${t.query}" and list what fits the candidate.`,
        model: ctx.settings.models.scan ?? ctx.settings.models.default,
        timeoutMs: 15 * 60_000,
        validate,
        web: true,
      });
      for (const it of value.items) {
        const kind = it.kind === 'programme' ? 'programme' : 'scholarship';
        const country = s(it.country, 60) || (t.type === 'country' ? t.name : '');
        const funding = (FUNDING_LEVELS as readonly string[]).includes(String(it.funding))
          ? (it.funding as FundingLevel)
          : 'unknown';
        const deadline = isoDate(it.deadline);
        intake.add(
          {
            url: s(it.url, 600),
            title: s(it.title, 200),
            company: s(it.org, 160),
            location: country,
            description: s(it.why, 800),
            kind,
            opportunity: seedOpportunity(kind, {
              funding,
              covers: s(it.covers, 400),
              countries: country ? [country] : [],
              university: kind === 'programme' ? s(it.org, 160) || null : null,
              deadlines:
                kind === 'scholarship'
                  ? { scholarship: deadline, admission: null }
                  : { scholarship: null, admission: deadline },
            }),
          },
          t.type === 'country' ? `ai-search · ${t.name}` : `ai-search · ${t.name}`,
        );
      }
      const added = intake.stats.added.length - before;
      recordCoverage(ctx.space.db, t.type, t.name, {
        found: value.items.length,
        added,
        note:
          value.note ||
          `${value.checked ? `${value.checked} checked, ` : ''}${value.items.length} fit, ${added} new`,
      });
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      const msg = clip((e as Error).message, 200);
      ctx.log('stderr', `${t.name}: ${msg}`);
      recordCoverage(ctx.space.db, t.type, t.name, {
        found: 0,
        added: 0,
        note: `Search failed: ${msg}`,
      });
    }
    ctx.saveCheckpoint({ next: i + 1, added: intake.stats.added });
    ctx.progress(i + 1, targets.length, 'searches');
  }
  return finishScan(ctx, intake, { targets: targets.length });
}
