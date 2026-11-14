import type { SearchQuery, SetupSuggestions, SourceEntry } from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { pageAnswers } from '../scan/providers.ts';
import { getSetup, saveSetup, studyFromSetup } from '../setup.ts';
import { clip } from '../util.ts';
import { placeCountries } from './coverage.ts';
import { catalogue, catalogueSource, countryFacts, entryFits } from './data.ts';
import { fetchFeed } from './feeds.ts';
import { studyYaml } from './mode.ts';

type Raw = Record<string, unknown>;
const s = (v: unknown, max = 200) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const strs = (v: unknown, max = 12) =>
  Array.isArray(v)
    ? v
        .map((x) => s(x, 60))
        .filter(Boolean)
        .slice(0, max)
    : [];

/**
 * Suggest sources for a scholarships account: the catalogue's schemes, university pages and feeds that
 * suit them, plus pages, feeds and searches AI finds for their subjects and countries. Every page AI
 * suggests must answer; every feed must parse.
 */
export async function studySourcesSuggest(ctx: RunCtx): Promise<RunOutput> {
  const cv = ctx.space.profile.get().cv;
  if (cv.trim().length < 200) throw new Error('Add your CV first: setup reads it.');
  const state = getSetup(ctx.space);
  const study = studyFromSetup(state);
  if (!study.subjects.length) throw new Error('Add at least one programme or subject first.');
  ctx.progress(0, 4, 'steps');
  const fitting = catalogue().filter((e) => entryFits(e, study));
  const countries = placeCountries([...study.places.prefer, ...study.places.allow])
    .map((c) => countryFacts(c))
    .filter((c) => c !== null);
  const { value } = await runSkill(ctx, {
    skill: 'study-sources-suggest',
    input: {
      study: studyYaml(study),
      cvFile: 'cv.md',
      alreadyListed: fitting.map((e) => ({ name: e.name, url: e.url })),
      countries,
    },
    files: { 'cv.md': cv.slice(0, 6000) },
    task: 'Suggest scholarship pages, feeds and searches for this person.',
    model: ctx.settings.models.scan ?? ctx.settings.models.default,
    timeoutMs: 15 * 60_000,
    validate: (v) => {
      const o = (v ?? {}) as Raw;
      if (!Array.isArray(o.pages) || !Array.isArray(o.queries))
        throw new Error('result.json needs "pages" and "queries" lists.');
      return o;
    },
    web: true,
  });
  ctx.progress(2, 4, 'steps');
  const offline = ctx.adapter.id === 'replay';
  const listed = new Set(fitting.map((e) => e.url.toLowerCase()));
  const raw = (value.pages as Raw[])
    .map((p) => ({
      name: s(p?.name, 120),
      url: s(p?.url, 500),
      kind: p?.kind === 'university' ? 'university' : 'scheme',
      countries: strs(p?.countries),
      note: s(p?.note, 300),
    }))
    .filter((p) => p.name && /^https?:\/\//.test(p.url) && !listed.has(p.url.toLowerCase()))
    .slice(0, 25);
  ctx.step(`Checking ${raw.length} pages`);
  const dropped: string[] = [];
  const pages: SourceEntry[] = [];
  await Promise.all(
    raw.map(async (p) => {
      if (offline || (await pageAnswers(p.url))) {
        pages.push({
          name: p.name,
          provider: 'page',
          careers_url: p.url,
          kind: p.kind,
          countries: p.countries,
          enabled: true,
          notes: p.note,
        });
      } else dropped.push(p.name);
    }),
  );
  pages.sort(
    (a, b) => raw.findIndex((r) => r.name === a.name) - raw.findIndex((r) => r.name === b.name),
  );
  const feeds: SourceEntry[] = [];
  for (const f of (Array.isArray(value.feeds) ? value.feeds : []) as Raw[]) {
    const url = s(f?.url, 500);
    const name = s(f?.name, 120);
    if (!name || !/^https?:\/\//.test(url) || listed.has(url.toLowerCase())) continue;
    try {
      if (!offline) await fetchFeed(url);
      feeds.push({ name, provider: 'rss', api: url, enabled: true, notes: s(f?.note, 300) });
    } catch {
      dropped.push(name);
    }
  }
  ctx.progress(3, 4, 'steps');
  const keywords = strs(value.erasmusKeywords, 15).map((k) => k.toLowerCase());
  const fromCatalogue = fitting.map((e) => {
    const entry = catalogueSource(e);
    return e.kind === 'erasmus' && keywords.length ? { ...entry, keywords } : entry;
  });
  const queries: SearchQuery[] = (value.queries as Raw[])
    .map((q) => ({ name: s(q?.name, 120), query: s(q?.query, 400), enabled: true }))
    .filter((q) => q.query)
    .map((q) => ({ ...q, name: q.name || q.query }))
    .slice(0, 8);
  const suggestions: SetupSuggestions = {
    companies: [...fromCatalogue.filter((e) => e.provider !== 'rss'), ...pages],
    careerSites: [],
    boards: [...fromCatalogue.filter((e) => e.provider === 'rss'), ...feeds],
    queries,
    titles: { positive: [], negative: [] },
    dropped,
  };
  saveSetup(ctx.space, { suggestions });
  ctx.progress(4, 4, 'steps');
  return {
    summary: `${suggestions.companies.length} pages, ${suggestions.boards.length} feeds, ${queries.length} searches${dropped.length ? ` · ${dropped.length} dead links dropped` : ''}`,
  };
}
